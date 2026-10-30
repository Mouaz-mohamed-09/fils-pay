#!/usr/bin/env bash
# Deploys the latest main to this server. Run on the server from the clone:
#
#   cd ~/bhash && ops/deploy.sh
#
# Pulls main (fast-forward only, so it never merges or overwrites local
# changes), rebuilds what changed and restarts it. Migrations run first via
# the compose `migrate` service; Postgres data lives in the named volume and
# survives every redeploy. ops/.env.prod stays on the server, never in git.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f ops/.env.prod ] || { echo "ops/.env.prod missing: copy ops/.env.prod.example and fill it in" >&2; exit 1; }

git pull --ff-only origin main
echo "deploying $(git log --oneline -1)"

docker compose -p filspay -f ops/docker-compose.prod.yml --env-file ops/.env.prod up -d --build --remove-orphans
docker compose -p filspay -f ops/docker-compose.prod.yml --env-file ops/.env.prod ps
