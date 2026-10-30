#!/usr/bin/env bash
# Runs every test suite against the dev compose stack, each API/reporting/Go
# suite on its own freshly migrated database (they share state otherwise:
# the events package leaves {}-payload outbox rows that break reporting).
#
#   ops/test-all.sh
#
# Expected: 5 locked API tests fail because they assert bugs finance
# reported (docs/AUDIT.md, "Test status"). Anything else is a regression.
set -uo pipefail
cd "$(dirname "$0")/.."
F=ops/docker-compose.yml
url() { echo "postgres://filspay:filspay_dev_password@postgres:5432/$1?sslmode=disable"; }
fresh() {
  docker compose -f $F exec -T postgres psql -U filspay -d filspay -qc "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1 OWNER filspay" >/dev/null 2>&1
  docker compose -f $F run --rm -e DATABASE_URL="$(url "$1")" --no-deps api npm run migrate >/dev/null 2>&1
}
suite() {
  printf "%-18s " "$2"
  docker compose -f $F run --rm -e NODE_ENV=test -e DATABASE_URL="$(url "$1")" --no-deps -w "/app/$2" api npm test 2>&1 \
    | grep -E "^# (pass|fail)|^not ok" | tr '\n' ' '
  echo
}

docker compose -f $F up -d postgres >/dev/null 2>&1
docker compose -f $F build api >/dev/null 2>&1

fresh fp_test_api; suite fp_test_api apps/api
fresh fp_test_rpt; suite fp_test_rpt apps/reporting
for w in apps/web packages/money packages/events; do suite fp_test_rpt "$w"; done

fresh fp_test_go
printf "%-18s " "apps/settlement"
docker run --rm -v "$PWD/apps/settlement":/src -v filspay_gomod:/go/pkg/mod -w /src --network ops_default \
  -e DATABASE_URL="$(url fp_test_go)" golang:1.22 sh -c 'go vet ./... && go test -count=1 ./... 2>&1' \
  | grep -E "^(ok|FAIL|---)" | tr '\n' ' '
echo
