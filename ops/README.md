# ops/

Local development stack for FilsPay: Postgres plus the three services that
talk to it directly (apps/api, apps/settlement, apps/reporting). The hosted
demo instance uses the same compose file with a different `.env`.

## Quick start

```
docker compose -f ops/docker-compose.yml up -d postgres
docker compose -f ops/docker-compose.yml run --rm migrate
docker compose -f ops/docker-compose.yml run --rm seed
docker compose -f ops/docker-compose.yml up api settlement reporting
```

apps/web and apps/admin aren't part of this compose file — they're plain
Vite dev servers that talk to apps/api over HTTP (`npm run dev` inside
each package), not services with their own database connection.

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | the stack |
| `.env.docker` | shared service settings, loaded by compose for every service |
| `Dockerfile.node` | image for api, reporting, migrate and seed (`node:22`, full install) |
| `Dockerfile.go` | multi-stage build of `apps/settlement` |

> **AM (July):** the two Dockerfiles aren't in the repo for me. built my own
>
> **MK:** they were in the initial ops commit. check you're on main

## Database

Every service, plus the one-off `migrate`/`seed` jobs, connects with the
same `filspay` role and the same `DATABASE_URL`
(`postgres://filspay:filspay_dev_password@postgres:5432/filspay?sslmode=disable`).
One role keeps local setup to a single password instead of hand-rolling
per-service grants for a stack this size. `sslmode=disable` is safe here:
Postgres and every service run on the same Docker Compose bridge network,
which never carries traffic outside the host, so there's no untrusted hop
for a connection to cross.

The settlement worker can be given a second connection string,
`PGCONN_SETTLEMENT`, for its batch-close pool. It only takes effect when
`DATABASE_URL` is unset.

To reset the database to a clean, freshly-seeded state at any point, re-run
the `seed` job above — `db/seed/index.ts` truncates and regenerates its
fixture tables on every invocation; it doesn't need the volume removed
first.

## Required settings per service

| Service | Needs | Where it comes from in compose |
|---|---|---|
| api | `DATABASE_URL`, `SETTLEMENT_INTERNAL_URL` | `environment:` |
| api | `WEBHOOK_SECRET_ENCRYPTION_KEY` | only outside dev; a dev key is used otherwise |
| api | `ACQUIRER_CALLBACK_SIGNING_SECRET`, `NODE_ENV` | `.env.docker` |
| settlement | `DATABASE_URL` | `environment:` |
| settlement | `SETTLEMENT_INTERNAL_TOKEN` | defaults to `dev-token` |
| reporting | `DATABASE_URL` | `environment:`; runs `worker` by default |

> **MK:** the api won't boot without WEBHOOK_SECRET_ENCRYPTION_KEY in any environment. set it on the hosted box.

## Resource sizing

The hosted demo box is 0.5 vCPU / 2 GB RAM / 2 GB disk; the API container is
limited to 512 MB. Postgres defaults are fine at this size. The settlement
image is built on the box with `go build` from `Dockerfile.go`.

> **AM:** first build on the box filled the disk (go build cache). cleared it and it went through on the second try

## Production (one 1 vCPU / 2 GB server)

`docker-compose.prod.yml` is the hosted stack: resource limits that fit the
box (API 0.5 vCPU / 512 MB), restart on crash, healthchecks, Postgres not
exposed, TLS and the built dashboards served by Caddy (`Dockerfile.gateway`,
`Caddyfile`), and no seed. Capacity numbers and the load test are in
`docs/CAPACITY.md`.

First time on a new server:

```
git clone https://github.com/Mouaz-mohamed-09/bhash-handover.git bhash && cd bhash
cp ops/.env.prod.example ops/.env.prod      # fill in secrets and domains
ops/deploy.sh
```

Every later deploy: push to `main`, then on the server `cd ~/bhash && ops/deploy.sh`
(fast-forward pull, rebuild, migrate, restart; data survives in the volume).

Point DNS for `SITE_DOMAIN` and `ADMIN_DOMAIN` at the server first; Caddy
then obtains certificates automatically. Ports 80/443 are the only ones
published.
