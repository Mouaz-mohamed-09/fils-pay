# AI usage and setup

**Draft for the team to review: replace or annotate with your own words.**

## Setup files in this repository

| File | Purpose |
|---|---|
| `CLAUDE.md` | Project instructions loaded by Claude Code: build/test commands, money rules, frozen packages, test policy. |
| `AGENTS.md` | Same conventions for any coding agent (Cursor, Copilot, etc.). |
| `docs/AUDIT.md`, `docs/CAPACITY.md` | Outputs the AI produced, each claim backed by a command, test or measurement. |

Both setup files contained **wrong instructions** when we started (see
excerpt 1). We corrected them, because an agent that trusts them would
reintroduce the bugs we fixed.

## How we checked the AI

Rule we followed: **an AI claim is a hypothesis until a command, a test or
the schema confirms it.** Code comments in this repo record several earlier
AI answers that were never checked and turned out false.

---

### Excerpt 1: the setup file itself was wrong

> **CLAUDE.md (as shipped):** "All monetary values … are stored as integer
> **cents** (1 BD = 100 cents)." "Settlement windows use **UTC midnight**."
> "`Math.random()` is acceptable for … payment link slugs, OTP codes."
>
> **Claude:** Before applying the handover steps, checked these against the
> ADRs and code: ADR-0001 says 1 BD = 1000 fils; `window.go` uses
> Asia/Bahrain; payment link tokens are bearer secrets. Flagged CLAUDE.md as
> wrong on all three and proposed correcting it first.

**Annotation:** We did not let the configuration file outrank the code and
the ADRs. Following CLAUDE.md here would have reintroduced finance's
"4.75 BD shows as 0.475" bug (M9) and kept guessable payment tokens (S7).

---

### Excerpt 2: earlier AI answers left in the code were false

> **Code comment, `apps/api/src/fees/platformVolumeTier.ts`:**
> "FH: platform_stats.total_processed_fils is BIGINT so no overflow risk
> (Claude double-checked the migration)"
>
> **Code comment, 0049:** "FH: asked claude — 'INTEGER in PostgreSQL is
> 64-bit on 64-bit builds'."
>
> **Code comment, `payout_notify.go`:** "claude: 'No, outbox_events has a
> unique index on (event_type, aggregate_id).'"
>
> **What we ran:** `cat db/migrations/0049_platform_stats.sql` → `INTEGER`
> (max 2,147,483,647, threshold 2,000,000,000); grep of every migration for
> outbox indexes → no such unique index.

**Annotation:** All three AI answers were wrong, and each one hid a real bug:
counter overflow (M10) and duplicate payout notifications (O3, incident
2026-08-21). We verified against the schema, not the model's recall.

---

### Excerpt 3: tests and load tests caught the AI's own mistakes

> **Claude (first pass):** fixed payment-link crash safety by marking a link
> paid if a capture already committed.
>
> **Test run:** `not ok 304 - idempotent replay after a reservation-timeout
> retry … expected: 200 actual: 409`
>
> **Claude:** the locked test shows the intended recovery: the same buyer's
> same-key retry must get a 200 replay. Changed the fix to replay for that
> key and refuse everyone else; 16/16 payment-link tests pass.

Other AI mistakes caught the same way: a SQL comment written outside a
template string (found by re-reading), a slim Docker image that could not
build `argon2` (found by building), and capacity "estimated" from theory
before measuring. The load test showed Postgres CPU, not the API, saturating
first, and `pg_stat_user_tables` exposed full ledger scans (R1).

**Annotation:** Nothing was reported as done until it ran: 441 TypeScript
tests, `go vet` + `go test`, an end-to-end refund through settlement,
reconciliation (gap 0) and a signed webhook verified against the raw bytes,
and a crash-under-load audit with 0 double charges.
