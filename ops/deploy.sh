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

# Don't redeploy during the nightly settlement close (00:00-01:00 Asia/Bahrain,
# UTC+3): the daemon closes the previous day 15 minutes after midnight.
# FORCE=1 overrides; even then the 2-minute stop grace period lets an
# in-flight batch finish, and batches are idempotent if one is cut short.
bahrain_hour=$(TZ=Asia/Bahrain date +%H)
if [ "$bahrain_hour" = "00" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "refusing to deploy between 00:00 and 01:00 Bahrain time (settlement close window); retry later or FORCE=1" >&2
  exit 1
fi

git pull --ff-only origin main
echo "deploying $(git log --oneline -1)"

docker compose -p filspay -f ops/docker-compose.prod.yml --env-file ops/.env.prod up -d --build --remove-orphans
docker compose -p filspay -f ops/docker-compose.prod.yml --env-file ops/.env.prod ps
