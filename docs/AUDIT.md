# FilsPay audit: findings and fixes (October 2026)

Every item from the case file (finance's Sep 17 list, the support tickets,
the handwritten notes and FP-300), plus what turned up while fixing them.
Each entry says what is wrong, why it happens, what it breaks, and the fix.
Fixes are the smallest change that works; existing (locked) tests were not
edited, and new coverage lives in `*.new.test.ts` / `*_new_test.go`.

Severity: **Critical** = money lost or another merchant's data/money
reachable. **High** = wrong money or a security control that doesn't hold.
**Medium** = wrong figures or degraded safety. **Low** = hygiene.

---

## Money

### M1. Scheme gets 10 fils more than the ledger on some lines (Critical)
*Finance: "scheme statement is always a few fils higher, never under".*
- **What:** `SchemeAmountBD` passed the raw `gross/1000` (e.g. 4.755) into
  `scheme_export_lines.amount NUMERIC(10,2)`. Postgres *rounds* on
  assignment, so 4.755 was stored and sent as 4.76, while `amount_fils`
  (truncated) said 4.750.
- **Breaks:** every line with a third decimal >= 5 overstates the scheme
  file by up to 9 fils. Always over, never under, exactly as finance saw.
- **Fix:** format the *truncated* fils from integers
  (`apps/settlement/internal/settlement/scheme_export.go`).

### M2. Scheme rounding residue never journaled (High)
- **What:** ADR-0002 said residue posting was implemented in CloseBatch.
  It wasn't. Only the one-off March script posted any.
- **Breaks:** ledger, settlement report and scheme statement can't agree.
- **Fix:** CloseBatch now posts, per line with residue, credit
  `card_scheme_clearing` and debit `scheme_rounding_residue` (`batch.go`).
  ADR-0002's status line corrected.

### M3. March sweep doubles if re-run (High)
- **What:** `reconcile_march.ts` uses a fresh `randomUUID()` per run; the
  comment claiming "entry_group_id dedupes it" is false. It also posts at
  `now()`, debits `merchant_payable` instead of `card_scheme_clearing`, and
  posts the opposite direction to ADR-0002.
- **Breaks:** a second run doubles the write-off (seen on staging).
- **Fix:** script refuses if the sweep is already in the ledger. Whether
  the production postings need reversing is finance's call (see Open items).

### M4. Net payout computed in float32 (Critical)
- **What:** `NetPayableFils` did `float32(gross)/1000 - float32(fee)/1000`.
  float32 holds ~7 significant digits.
- **Breaks:** any batch above ~16,777 BD pays out a rounded figure.
- **Fix:** `gross - fee` in integer fils (`payable.go`).

### M5. Split payouts a few fils short every batch (High)
*Finance: Delta Marketplace children don't add up to the parent.*
- **What:** each child share was `ApplyRateFils(net, weight)`, rounded
  independently. The remainder stayed in the parent's `merchant_payable`
  and was never paid to anyone. Weights were never checked to sum to 10000.
- **Fix:** largest-remainder allocation in `ChildShares` (shares always sum
  to net), used by `PayoutSplitBatch`, which now refuses weights != 10000
  (`apps/settlement/internal/splits/`).

### M6. "Recalculate cached balances" wiped balances (Critical, FP-203)
*Alpha Retail 135K → 7K.*
- **What:** the button called `RefreshBalanceCache`, which reads the
  `merchant_payable_position` view: the sum of scheme export lines. That
  is gross of fees and ignores payouts and every unsettled capture. The
  CLI walks `ledger_entries`.
- **Fix:** the internal endpoint now uses the CLI's ledger walk
  (`internalapi/server.go`). Note ADR-0004's 30 s timeout concern still
  applies on very large ledgers.

### M7. MDR recalculation rewrote paid batches (High)
- **What:** selected `status <> 'open'`, so paid batches had `fee_fils` /
  `net_payout_fils` rewritten after the money had left. It also priced all
  history at `merchants.mdr_bps`, ignoring the effective-dated
  `fee_schedules`.
- **Fix:** closed batches only; per-event rate from `fee_schedules` as
  CloseBatch does (`recalculate_mdr.go`).

### M8. Dashboard shows 245 bps, merchants pay 225 (Medium)
- **What:** the display picked the newest `fee_schedules` row by
  `created_at`; a backdated backfill entered later shows as "current".
  Billing uses `effective_from <= now()`.
- **Fix:** display uses the billing rule (`currentFeeScheduleDisplay.ts`).
  **A locked test asserts the old behaviour**: see Open items.

### M9. CSV import reads BD as two decimals (High)
*Finance: 4.75 BD became 0.475.*
- **What:** `parseAdjustmentAmountFils` used `parseDecimalMinor(raw)` with
  its default of 2 decimals: "4.75" → 475 fils; a 3rd decimal truncated.
- **Fix:** `parseBhdToFils` (ADR-0001) (`adjustmentCsvParsing.ts`).

### M10. Platform volume counter overflows (High)
- **What:** `platform_stats.total_processed_fils` is `INTEGER` (max
  2,147,483,647) with a 2,000,000,000 tier threshold; Go added with
  `int32(...)`, which wraps silently.
- **Fix:** migration 0073 → `BIGINT`; Go `int64`.

### M11. Lifetime payout estimate drifts (Low)
- **What:** `REAL` column fed through `float32`, exact only to 2^24 fils.
- **Fix:** migration 0074 → `BIGINT`; Go passes `int64`.

### M12. Reconciliation never ties (Medium)
- **What:** "pending" used a float estimate with `Math.round`, the
  merchant's current `mdr_bps` (the "0046 trigger" it relied on doesn't
  exist), and ignored refunds despite its doc comment.
- **Fix:** same formula as settlement (point-in-time schedule, tier bonus,
  `applyRateFils`), minus unbatched refunds (`settlement/query.ts`).

## Security

### S1. Login without OTP (Critical)
- **What:** `lookupSession` read the `live_sessions` view, which doesn't
  filter `authenticated`. A password-only pending session counted as
  logged in everywhere.
- **Fix:** `AND s.authenticated = true` (`auth/sessions.ts`).

### S2. Logged into the wrong merchant (Critical)
- **What:** after the password check for the user at merchant B, the OTP
  challenge and session were created for `findOtpRecipient(email)`: the
  first user with that email *at any merchant*.
- **Fix:** challenge and session belong to the user whose password was
  checked (`routes/auth.ts`).

### S3. OTP brute force (High)
- **What:** attempts were read, compared, then incremented, so parallel
  guesses all saw `attempt_count = 0`. Resend issued a new challenge at 0
  attempts despite the comment saying it inherits. Admin login had the same
  race (its "FOR UPDATE" comment was wrong).
- **Fix:** spend an attempt atomically before comparing; consume
  atomically; resend carries the count (`routes/auth.ts`, `routes/adminAuth.ts`).

### S4. Cancel another merchant's payment link (High)
- **What:** cancel matched `id` only; the route checked the path merchant,
  not the link's owner.
- **Fix:** `AND merchant_id = $2` (`paymentLinks/cancel.ts`).

### S5. Payment link paid after expiry (High, FP-187)
- **What:** expiry checked against the client-sent `submittedAt`.
- **Fix:** clamped to [now − 5 min, now] (`paymentLinks/pay.ts`).

### S6. Payment link charged twice (Critical, incident 2026-05-14)
- **What:** a reservation had no owner. When a slow request's lease
  lapsed, a second buyer re-claimed; the first request's
  `finalize … WHERE status = 'reserved'` matched the *second* reservation.
- **Fix:** each claim stamps `reservation_id` (migration 0076); renew and
  verify ownership before capture, finalize/release only our own.

### S7. Guessable tokens (High)
- **What:** payment link tokens, OTP codes and admin invite codes used
  `Math.random()`.
- **Fix:** `crypto.randomInt` (`lib/random.ts`, `admin/inviteCode.ts`).

### S8. Impersonation could write (High)
- **What:** super_admin impersonated as merchant **owner** (finance as
  finance), despite docs saying "always support, read-only". Writes were
  recorded as the merchant's own session. Disabled admins kept grants:
  the "admin-disable trigger" doesn't exist.
- **Fix:** every admin role maps to `support`; `requireMerchantWriterActor`
  refuses impersonation; grant lookup requires an active admin
  (`admin/impersonation.ts`, `auth/requireMerchantAuth.ts`).

### S9. Support role could capture and void (Medium)
- **Fix:** capture/void require owner or finance (`routes/transactions.ts`).

### S10. Key rotation never retires the old key (High)
- **What:** rotation issued a new key and left the old one valid forever;
  `revoke_after` (0056) was never set or checked.
- **Fix:** rotation sets `revoke_after = now() + 24h`; verification honours
  it (`admin/apiKeys.ts`, `apiKeys/verify.ts`).

### S11. Duplicate acquirer callback notes (Medium, FP-201 reopened)
- **What:** no dedupe existed. The `processed_events` table and FP-238
  index in the comments were never built.
- **Fix:** unique `callback_id` (migration 0075, keeps the earliest
  duplicate) + `ON CONFLICT DO NOTHING`.

### S12. Webhook signatures fail at merchants (High, FP-240)
- **What:** signed `canonicalJson(payload)`, sent `JSON.stringify(payload)`.
  Inbound check compared with `Buffer.compare` (not constant-time).
- **Fix:** send the exact signed bytes; `timingSafeEqual` inbound. Inbound
  still has no freshness window (a locked test signs with a 2025 timestamp);
  callback dedupe (S11) makes replays harmless.

### S13. Acquirer callback signatures optional by default (Medium)
- **Fix:** required by default when `NODE_ENV=production`.

### S14. Credit two-person control compared display names (High)
- **Fix:** compare admin user ids (`admin/creditApproval.ts`).

### S15. Seed wipes the whole database (High)
- **What:** compose and README say the seed "only truncates its own
  fixtures"; it TRUNCATEs merchants, transactions, ledger_entries and
  outbox_events with CASCADE.
- **Fix:** refuses under `NODE_ENV=production`; comments corrected.

## Operations and reporting

### O1. Daily close at 03:00, not midnight (Medium)
- **What:** daemon passed a UTC instant to `BusinessDayWindow`, which takes
  the calendar date in the argument's own zone.
- **Fix:** `BusinessDateOf` converts to Bahrain first (`window.go`, `daemon.go`).

### O2. Test merchants in the real settlement run (High)
- **What:** the admin "recompute statuses" tool called
  `reconcileSandboxFlag`, which set `test_mode = false` whenever a merchant
  had no open authorizations.
- **Fix:** side effect removed (`routes/adminMerchantsRecompute.ts`).

### O3. Duplicate payout notifications (Medium, incident 2026-08-21)
- **What:** NOT EXISTS then INSERT; overlapping runs both inserted. The
  unique index the comment cited doesn't exist.
- **Fix:** partial unique index on new `settlement.paid` rows (migration
  0077) + `ON CONFLICT DO NOTHING`.

### O4. Slow reporting query (Low)
- **What:** `getRecentLedgerActivity` cast `occurred_at` per row, so the
  `(merchant_id, occurred_at)` index couldn't be used.
- **Fix:** sargable Bahrain-day range (`analytics/query.ts`).

### O5. Large export takes the API down (Medium)
- **What:** the export route built the whole CSV in memory (API sized
  512 MB). The streaming variant skipped rows sharing a timestamp across
  page boundaries. KYC upload accepted any number of files, each buffered.
- **Fix:** route streams; keyset on `(occurred_at, id)`; multipart limited
  to one file.

## FP-300: refunds, finished

The unfinished feature was refunds. The helpers existed but had these bugs:

| Bug | Effect | Fix |
|---|---|---|
| Transaction looked up by id only, refunded as *its* merchant | any merchant could refund anyone's payment | scoped to the caller's merchant |
| Refundable = authorized − refunded | refund more than was charged on partial captures | captured − refunded |
| Validate in one transaction, write in another from a stale total | two concurrent refunds both pay out (FP-209) | one transaction, row locked across the acquirer call (capture's pattern) |
| Fee reversal rounded per partial | partials could reverse more fee than charged | cumulative reversal |
| `reason` passed as NULL | every reasonless refund failed 0070's check | defaults to `unspecified` |
| Settlement ignored refunds | refunded sales still paid out in full | CloseBatch nets refunds, carries overflow forward |
| `refund.succeeded` not webhook-eligible, no envelope | merchant never told | added |
| Reporting skipped refunds; rollup used UTC date; columns missing; summary view joined `t.id = r.id` | refunds invisible in reports | wired in; Bahrain date; migration 0078 |
| Drawer: new idempotency key per click; hidden on partially refunded | double click = double refund | key per attempt; uses `refundedFils` |

Endpoints: `POST /v1/merchants/:merchantId/refunds` (owner/finance or API
key; `Idempotency-Key` header required; body `transactionId`, optional
`amountFils`, optional `reason`) and `GET /v1/merchants/:merchantId/refunds`.
The old `POST /v1/refunds` stub still answers 501 (a locked test asserts it).

## Found while running, testing and load testing

### R1. Every checkout scanned the whole ledger (High, capacity)
- **What:** 0007's balance trigger fires per inserted leg and sums
  `WHERE entry_group_id = …`; no index on `entry_group_id`, nor on the
  `transaction_id` lookups (ledger, holds). 376M rows read for ~7k checkouts.
- **Breaks:** checkout latency grows with ledger size; capacity halves.
- **Fix:** migration 0079. See docs/CAPACITY.md.

### R2. Crash between capture and finalize: charged buyer, re-payable link (Critical)
- **What:** capture and the link's `paid` update are separate commits. A
  process kill in between (reproduced under load) left the link `reserved`;
  after the timeout anyone could pay it again.
- **Fix:** before claiming, `payPaymentLink` marks a link paid if a capture
  for it already committed (migration 0080 indexes that lookup); the same
  buyer's same-key retry gets a 200 replay, anyone else gets 409.

### R3. Dashboards could not log in from a browser (High, UI)
- **What:** the API registers no CORS handling, yet both dashboards call it
  cross-origin with cookies; every preflight 404s.
- **Fix:** same-origin `/v1` proxy (Vite in dev, Caddy in production).

### R4. Migrations 0054 and 0055 could never apply (High, reproducibility)
- 0054's view referenced a `settlement_batch_events` table that never existed;
  0055 inserted into columns and a `kind` that `chart_of_accounts` doesn't
  have. A fresh database stopped at 0054. Fixed in place (they could not have
  applied anywhere).

### R5. Built-in dev webhook key was 34 bytes (Medium)
- The config requires exactly 32, so a dev environment without an explicit
  key could not start. Replaced with a valid 32-byte dev-only key.

### R6. Test runner and flaky test (Medium)
- Workspace test scripts pass globs to `node --test`, which Node 20 does not
  expand, so the API, reporting and web suites never ran. Images now use Node 22.
- `backoffDelayMs` defaulted to random jitter while its test expected the
  exact base delay; the default is now neutral and the dispatcher passes
  `Math.random` explicitly.
- Suites share one database in `npm test`; the events package's tests leave
  `{}`-payload outbox rows that crash the reporting suite. Each suite passes
  on its own database.

### R7. Overload handling (Medium, capacity)
- No admission control: under load every request queued on the pool until
  timeouts. Added `plugins/loadShedding.ts` (503 + Retry-After past
  `MAX_INFLIGHT_REQUESTS`).

### R8. Production OTP is never delivered (High, operability)
- **What:** there is no email/SMS gateway ("console only until the SMS
  gateway contract lands"), and in production the code is not logged either,
  so no admin or merchant can complete login on a production deployment.
- **Demo decision:** the live demo sets `OTP_DEV_EXPOSE=true`, returning the
  code to the login screen. This reduces login to password-only and is a
  documented demo limitation; a real deployment needs an email/SMS provider.

### R9. Transaction page crashed for refunded payments (High, UI)
- **What:** the timeline formatted a refund's negative amount with `toFils`,
  which rejects negatives, so every refunded transaction's page crashed.
  Found by the before/after screenshot run. **Fix:** signed formatting in
  `format.ts`; plus a fallback for `crypto.randomUUID` (missing outside
  secure contexts) and a branded error page. See docs/UI_EVIDENCE.md.

### S16. Public payment link leaked API key material (High, security)
- **What:** `GET /v1/payment-links/:token` (public, no login) returned the
  merchant's newest API key prefix (16 characters, 8 of them secret) and the
  key's SHA-256 hash, the value the server authenticates against. Found by
  reading the live response.
- **Fix:** only the 8-character environment marker (`fp_live_` / `fp_test_`)
  is returned; the hash is no longer selected (`paymentLinks/read.ts`).

### S17. Secret committed to the repository (High, security)
- **What:** `ops/.env.docker` is tracked in the challenge repository (since
  its first commit) and contains `ACQUIRER_CALLBACK_SIGNING_SECRET`. Its
  comment relied on a Copilot answer that `.env` in `.gitignore` matches
  `.env.docker` "as a prefix"; gitignore has no prefix matching.
- **Found:** moving our work into the fork; `git show fork/main:ops/.env.docker`.
- **Fix:** file removed from the tree; `ops/.env.docker` stays git-ignored;
  production uses its own secret generated on the server (`ops/.env.prod`).
- **Existing data:** the sandbox secret remains in git history and must be
  rotated with the acquirer.

### R10. The bare domain showed "Page not found" (High, UI)
- The web app had no route for `/`; only `/pay/...` and `/dashboard/...`.
  Found by testing the live link from a phone. `/` now redirects to the
  dashboard (sign-in when logged out).

## Live deployment

`https://143-110-242-142.sslip.io` (checkout + merchant dashboard) and
`https://admin.143-110-242-142.sslip.io` (admin console) on Dilmune Cloud,
1 vCPU / 2 GB, Let's Encrypt TLS, only ports 22/80/443 open. First admin
created with `ops/create-admin.ts` (random password, shown once).

## Test status (October 30)

| Suite | Result |
|---|---|
| packages/money | 40/40 |
| packages/events | 4/4 |
| apps/web | 8/8 |
| apps/reporting (own DB) | 11/11 |
| apps/settlement (`go vet` + `go test`) | all 7 packages pass |
| apps/api (own DB) | 373/378: the 5 failures are the locked tests below |

**Locked tests that assert the bugs finance reported** (fixes kept, tests not edited):
- `adminAdjustmentImport.test.ts` "a valid CSV upload…", and
  `adjustmentImport.test.ts` ×3: expect "4.75" BD → 475 fils (M9).
- `currentFeeScheduleDisplay.test.ts` "backfilled later": expects 245 bps (M8).

## Open items (need a person)

1. **Locked tests assert bugs:** see "Test status" above (M8, M9).
2. **March postings in production:** whether to reverse them needs finance in writing.
3. Refunds settle oldest-first; a merchant whose refunds exceed captures
   for days carries the difference forward (no negative payout or debit).
4. `merchants.refunds_enabled` NULL means "no hold" in code; a note in 0052
   says NULL should mean disabled. Product decision.
5. Inbound callback freshness window and raw-body verification.
6. ADR-0004's button timeout: the ledger walk may need to run async on big data.
7. The five locked tests above need their owner to accept the corrected behaviour.
