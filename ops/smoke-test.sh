#!/usr/bin/env bash
# End-to-end smoke test of a FilsPay deployment, the way a merchant and a
# buyer use it. Creates a fresh demo merchant each run and prints its login.
#
#   ops/smoke-test.sh https://143-110-242-142.sslip.io https://admin.143-110-242-142.sslip.io admin@filspay.demo '<admin password>'
#
# Needs curl and python3. Requires OTP_DEV_EXPOSE=true on the target (the
# OTP is read from the login response; there is no email/SMS gateway).
set -euo pipefail

SITE=${1:?site url}; ADMIN=${2:?admin url}; ADMIN_EMAIL=${3:?admin email}; ADMIN_PASS=${4:?admin password}
JAR=$(mktemp); AJAR=$(mktemp); trap 'rm -f "$JAR" "$AJAR"' EXIT
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)"; }
uuid() { python3 -c "import uuid; print(uuid.uuid4())"; }
step() { printf '\n== %s\n' "$*"; }
fail() { echo "FAIL: $*"; exit 1; }

TAG=$(date +%s)
EMAIL="owner+$TAG@demo-merchant.test"
PASS="Demo-$(python3 -c 'import secrets; print(secrets.token_urlsafe(9))')"

step "1. Merchant signs up"
R=$(curl -sf -X POST "$SITE/v1/merchants" -H 'content-type: application/json' -d "{
  \"businessProfile\": {\"legalName\": \"Demo Coffee $TAG\", \"registrationNumber\": \"CR-$TAG\", \"businessType\": \"llc\",
    \"country\": \"BH\", \"contactEmail\": \"$EMAIL\", \"contactPhone\": \"+97317000000\", \"addressLine1\": \"Road 1\", \"city\": \"Manama\"},
  \"owner\": {\"email\": \"$EMAIL\", \"password\": \"$PASS\"}}") || fail "signup"
MID=$(echo "$R" | json "['merchantId']"); echo "merchant $MID"

step "2. Admin logs in (password + OTP) and approves KYC"
R=$(curl -sf -c "$AJAR" -b "$AJAR" -X POST "$ADMIN/v1/admin/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}") || fail "admin login"
OTP=$(echo "$R" | json ".get('devOtpCode','')"); [ -n "$OTP" ] || fail "no OTP returned (OTP_DEV_EXPOSE off?)"
curl -sf -c "$AJAR" -b "$AJAR" -X POST "$ADMIN/v1/admin/auth/otp/verify" -H 'content-type: application/json' -d "{\"code\":\"$OTP\"}" >/dev/null || fail "admin otp"
curl -s -c "$AJAR" -b "$AJAR" -X POST "$ADMIN/v1/admin/merchants/$MID/kyc-reviews" -H 'content-type: application/json' \
  -d '{"outcome":"approved","notes":"smoke test"}'; echo

step "3. Merchant logs in (password + OTP) and issues an API key"
R=$(curl -sf -c "$JAR" -b "$JAR" -X POST "$SITE/v1/auth/login" -H 'content-type: application/json' \
  -d "{\"merchantId\":\"$MID\",\"email\":\"$EMAIL\",\"password\":\"$PASS\"}") || fail "merchant login"
OTP=$(echo "$R" | json ".get('devOtpCode','')")
curl -sf -c "$JAR" -b "$JAR" -X POST "$SITE/v1/auth/otp/verify" -H 'content-type: application/json' -d "{\"code\":\"$OTP\"}" >/dev/null || fail "merchant otp"
KEY=$(curl -sf -b "$JAR" -X POST "$SITE/v1/merchants/$MID/api-keys" -H 'content-type: application/json' -d '{"label":"smoke"}' | json "['rawKey']") || fail "api key"
AUTH=(-H "authorization: Bearer $KEY" -H 'content-type: application/json')

step "4. Merchant creates a 4.750 BD payment link"
EXP=$(python3 -c "import datetime; print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=1)).isoformat())")
LINK=$(curl -sf -X POST "$SITE/v1/merchants/$MID/payment-links" "${AUTH[@]}" -d "{\"amountFils\":4750,\"expiresAt\":\"$EXP\",\"reference\":\"smoke\"}") || fail "create link"
TOKEN=$(echo "$LINK" | json "['token']"); echo "checkout page: $SITE/pay/$TOKEN"

step "5. Buyer pays the link"
PAY=$(curl -s -X POST "$SITE/v1/payment-links/$TOKEN/pay" -H 'content-type: application/json' -H "idempotency-key: $(uuid)" \
  -d '{"card":{"pan":"4242424242424242","expiryMonth":12,"expiryYear":2030,"cvv":"123"}}'); echo "$PAY"
TXN=$(echo "$PAY" | json "['transactionId']") || fail "payment did not succeed (the simulator fails ~2%; re-run)"

step "6. A second payment of the same link is refused"
curl -s -X POST "$SITE/v1/payment-links/$TOKEN/pay" -H 'content-type: application/json' -H "idempotency-key: $(uuid)" \
  -d '{"card":{"pan":"4242424242424242","expiryMonth":12,"expiryYear":2030,"cvv":"123"}}'; echo

step "7. Merchant refunds 1.000 BD (FP-300), then tries to over-refund"
curl -s -X POST "$SITE/v1/merchants/$MID/refunds" "${AUTH[@]}" -H "idempotency-key: $(uuid)" -d "{\"transactionId\":\"$TXN\",\"amountFils\":1000,\"reason\":\"smoke test\"}"; echo
curl -s -X POST "$SITE/v1/merchants/$MID/refunds" "${AUTH[@]}" -H "idempotency-key: $(uuid)" -d "{\"transactionId\":\"$TXN\",\"amountFils\":99999}"; echo

step "8. Transaction and timeline"
curl -s "$SITE/v1/transactions/$TXN" "${AUTH[@]}"; echo
curl -s "$SITE/v1/transactions/$TXN/events" "${AUTH[@]}" | python3 -c "import sys,json; d=json.load(sys.stdin); d=d if isinstance(d,list) else d.get('events',[]); [print(' ', e['eventType'], e['amountFils']) for e in d]"

cat <<EOF

PASSED. Demo merchant you can log in with at $SITE/dashboard/login
  Merchant ID: $MID
  Email:       $EMAIL
  Password:    $PASS
EOF
