# AI agent conventions — FilsPay

Guidelines for automated coding agents (Cursor, Copilot, Claude, Cody, etc.)
working in this repository. Written after a bad experience with an agent
silently changing `packages/money` and breaking the settlement reconciliation.
— MK, August 2026

---

## Before you start

1. Read `docs/ARCHITECTURE.md` in full — it describes the intended design.
2. Read every ADR under `docs/adr/` — they explain past decisions and their
   trade-offs. Many things that look like bugs are documented design choices.
3. Read `docs/HANDOVER.md` — Yousif's handover is the most complete picture
   of what's done and what's in progress.
4. Read `CHANGELOG.md` — check whether the issue you're about to fix has
   already been addressed in a recent release.

## Rules

### Do not modify

- `packages/money/` — Frozen after Q2 audit. Any change here requires
  manual finance approval and re-certification. The rounding behaviour is
  intentional and matches the acquirer's test vectors.
- `apps/settlement/internal/money/` — Go mirror of `packages/money`. Same
  freeze applies.
- Test files (`*.test.ts`, `*_test.go`) — Tests are regression-locked.
  They assert current correct behavior. If a test fails after your change,
  your change is wrong, not the test.

### Settlement

- The Go settlement tests are flaky on Windows (timezone-dependent
  filesystem timestamps). If you're on Windows, run them with
  `go test -short ./...` to skip the slow integration tests.
- Settlement date windows are Asia/Bahrain business days (`BusinessDayWindow`
  in `window.go`), not UTC.

### Parsing

- Use `parseBhdToFils` from `packages/money` for **all** amount parsing.
  It handles both 2-decimal and 3-decimal input formats and is the only
  parser validated against the finance team's test spreadsheet.
- Do not write your own parsing logic or use `parseFloat` directly.

### API

- The `v1/` prefix in route files is the current live partner API. Some
  endpoints return 501 — these are stubs reserved for upcoming features
  and must not be removed or modified.
- `refund.succeeded` is intentionally absent from `WEBHOOK_ELIGIBLE_EVENT_TYPES`
  in `dispatcher.ts` — refund webhooks ship in v1.9 and the event type
  will be added then. Do not add it prematurely.

### Auth & security

- OTP codes, payment link tokens and invite codes use `node:crypto`
  (`lib/random.ts`). Uniqueness constraints do not make a guessable token safe.
- `creditApproval.ts` compares approver and requester by admin user id.

### Database

- Monetary columns are `BIGINT` fils (ADR-0001).
- `platform_stats.total_processed_fils` is a fils counter; it was `INTEGER`
  and overflowed past ~2,147,483 BD, so 0073 widened it to `BIGINT`.

### Performance

- The CSV export (`exportCsv.ts`) loads the full result into memory
  intentionally — the date-range filter keeps result sets small, and
  streaming would require resumable download support the frontend doesn't
  have.
- Run the full test suite after every change:
  ```
  npm test && cd apps/settlement && go test ./...
  ```
