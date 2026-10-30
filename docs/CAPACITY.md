# Capacity: estimate and evidence

## Our estimate (measured on the live Dilmune server)

**About 10 checkouts per second sustained** (≈30 HTTP requests/s) with pay
p95 under 2 s and every response correct; **about 16/s is the ceiling**.
Beyond that the API turns the excess away with an immediate
`503 Retry-After: 1` and keeps answering admitted requests correctly.

One checkout = 3 HTTP requests (merchant creates link, buyer opens it, buyer
pays = acquirer authorize + capture). Latencies include the simulated
acquirer (two calls of 100–400 ms each) and the internet round trip from
the load generator.

Live server: Dilmune Cloud, 1 vCPU / 2 GB, Ubuntu 24.04, the stack in
`ops/docker-compose.prod.yml` (API 0.5 vCPU / 512 MB), load generated from a
laptop over the internet against `https://143-110-242-142.sslip.io`.

| Live, offered (checkouts/s) | Completed/s | Pay p95 | Correct | Shed (503) |
|---|---|---|---|---|
| 10 | 8.7 | 1.76 s | 100 % | 0 |
| 14 | 12.0 | 2.86 s | 100 % | 0 |
| 20 | 16.3 | 3.3 s | 100 % | 60 |

At 20/s Postgres sits at its 0.35 vCPU cap and the API at ~0.2 vCPU; the
server's cores are about 3× slower than the laptop used for the tuning runs
below, so the laptop numbers (~30/s) are not the estimate.

## How to reproduce

```bash
docker compose -p filspay-prod -f ops/docker-compose.prod.yml --env-file ops/.env.prod up -d --build
docker compose -p filspay-prod -f ops/docker-compose.prod.yml --env-file ops/.env.prod \
  run --rm --no-deps api npx tsx ops/load/setup.ts          # prints merchantId + apiKey
GW=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' filspay-prod-gateway-1)
docker run --rm --network filspay-prod_default -v "$PWD/ops/load":/load \
  -e BASE_URL=https://localhost -e GATEWAY_IP=$GW -e MERCHANT_ID=... -e API_KEY=... \
  -e RATE=30 -e RAMP=15s -e HOLD=45s grafana/k6:0.54.0 run /load/checkout.js
```

The simulated acquirer is left at its defaults (100–400 ms per call, 2 %
failure rate). Its 502 `acquirer_unavailable` and 402 declines are correct
answers and are counted separately from server errors.

## Tuning runs (laptop, Docker Desktop, same limits)

| Offered (checkouts/s) | Completed/s | Pay p95 | Correct | Shed (503) | Notes |
|---|---|---|---|---|---|
| 10 | 8.8 | 776 ms | 100 % | 0 | before fixes |
| 20 | 16.5 | 2.73 s | 100 % | 69 | before fixes: pool of 10 saturated |
| 20 | 16.8 | 2.27 s | 100 % | 0 | pool 25: Postgres pinned at its 0.25 vCPU |
| 30 | 26.0 | 780 ms | 100 % | 0 | **after ledger indexes (0079)** |
| 40 | 33.9 | 1.32 s | 100 % | 27 | ceiling |
| 50 | 42.5 | 1.05 s | 100 % | 45 | |
| 60 | 44.2 | 3.1 s | 100 % | 470 | past the limit: excess shed, answers still correct |

(Rows run back to back on a growing database; the 40/s row is the latest,
on the largest ledger, and is the one the estimate is based on.)

## What limited it, and what we changed

1. **Every checkout scanned the whole ledger.** `pg_stat_user_tables` showed
   `ledger_entries` with 27k sequential scans reading 376M rows and zero
   index scans. 0007's balance trigger runs per inserted leg and filters by
   `entry_group_id`, which had no index; holds and ledger lookups by
   `transaction_id` had none either. Cost per checkout grew with ledger
   size. Migration 0079 adds the indexes: p95 at 30/s went from >3 s to 780 ms.
2. **The connection pool, not CPU, bounds throughput.** Each pay holds a
   connection through two acquirer calls (~0.55 s). Little's law:
   25 connections / 0.55 s ≈ 45 pays/s, matching the observed plateau.
   `PG_POOL_MAX=25` (Postgres `max_connections=40`).
3. **Postgres was the first CPU to saturate**, not the API (API ~0.1–0.15
   vCPU of its 0.5). The CPU budget gives Postgres 0.35 vCPU.
4. **Admission control** (`apps/api/src/plugins/loadShedding.ts`): beyond
   `MAX_INFLIGHT_REQUESTS=64` the API answers 503 at once instead of queueing
   on the pool, so admitted requests stay fast. Health probes are exempt.
5. Request logging at `LOG_LEVEL=warn` in production.

## Overload, restart and recovery

Test: 60 checkouts/s (beyond capacity), then `kill -9` the API process mid-run.

- Docker restarted the API (`restart: unless-stopped`); the healthcheck went
  back to healthy within seconds; the gateway fails fast (2 s) while it is down.
- Post-crash audit: 0 unbalanced ledger groups, 0 paid links without a
  captured transaction, 0 captured transactions missing ledger legs or
  outbox events, 0 idempotency keys stuck in progress, **0 double charges**.
- The first crash test found a real bug: a kill between capture and
  finalize left a charged buyer with a re-payable link (2 links). Fixed in
  `paymentLinks/pay.ts` (crash repair before claim; the original buyer's
  same-key retry still gets a 200 replay). Re-run: 0 orphans, 0 double charges.

Durability: Postgres keeps `fsync` and `synchronous_commit` on, data is on a
named volume, and every money write commits together with its ledger legs
and outbox event, so a crash or restart never loses a committed payment.
