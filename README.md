# FilsPay: The Handover

Payment platform for Bahraini merchants: card payments through payment links,
refunds, daily settlement and payouts, all in integer fils (1 BD = 1000 fils).
This repository is our submission: the inherited codebase audited, 52 bugs
fixed, the unfinished refunds feature (FP-300) completed, and the stack
deployed on Dilmune Cloud.

## Live

| | |
|---|---|
| Checkout and merchant dashboard | https://143-110-242-142.sslip.io |
| Ops (admin) console | https://admin.143-110-242-142.sslip.io |
| Health | https://143-110-242-142.sslip.io/healthz |

One Dilmune server, 1 vCPU / 2 GB RAM, the API limited to 0.5 vCPU / 512 MB,
HTTPS with Let's Encrypt, only ports 22/80/443 open. Login credentials are in
our submission document, not in this public repository. The demo has no
email/SMS gateway, so the one-time code is shown on the login screen
(documented as finding R8).

## What we did

- **Audit and fixes:** 53 bugs across money, security, settlement, reporting
  and UI, each with root cause and fix: [docs/AUDIT.md](docs/AUDIT.md).
- **FP-300 refunds, end to end:** API, ledger, fee reversal, settlement
  netting, `refund.succeeded` webhook, timeline, reports and reconciliation.
- **Capacity:** about 10 checkouts/s sustained on the live server, ~16/s
  ceiling, excess shed with 503, 0 double charges after a crash under load:
  [docs/CAPACITY.md](docs/CAPACITY.md).
- **UI/UX:** redesigned checkout, dashboard and admin console with before and
  after screenshots: [docs/UI_EVIDENCE.md](docs/UI_EVIDENCE.md).
- **AI usage:** setup files ([CLAUDE.md](CLAUDE.md), [AGENTS.md](AGENTS.md))
  and how we checked the AI: [docs/AI_USAGE.md](docs/AI_USAGE.md).
- **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the ADRs in
  [docs/adr/](docs/adr/).

## Run it locally

Needs Docker.

```bash
docker compose -f ops/docker-compose.yml up -d postgres
docker compose -f ops/docker-compose.yml run --rm migrate
docker compose -f ops/docker-compose.yml run --rm seed      # wipes the local DB
docker compose -f ops/docker-compose.yml up -d
```

Merchant dashboard on http://localhost:5173, admin console on
http://localhost:5174, API on http://localhost:3000.

## Deploy

On the server, from a clone of this repo with `ops/.env.prod` filled in from
`ops/.env.prod.example`:

```bash
ops/deploy.sh    # pull main, rebuild, migrate, restart; data persists
```

Details in [ops/README.md](ops/README.md).

## Test

```bash
ops/smoke-test.sh <site url> <admin url> <admin email> '<admin password>'   # live end to end
```

Unit and integration suites (each on its own database) are described in
[docs/AUDIT.md](docs/AUDIT.md#test-status-october-30): 441 TypeScript tests and
all Go packages pass, except five locked tests that assert bugs finance
reported. Load test: [ops/load/checkout.js](ops/load/checkout.js).
