# FilsPay — Claude Code configuration

Team conventions for AI-assisted development. Read this before making any
changes. Last updated September 2026 — MK.

---

## Build & test

After **every** file change, run the full test suite to catch regressions:

```bash
npm test                                    # TS: all packages + apps
cd apps/settlement && go test ./...         # Go: settlement service
```

Both must pass before you suggest the change is complete. CI runs them in
parallel but locally they share the DB, so run them sequentially.

## Money

All monetary values are **integer fils** (1 BD = 1000 fils), stored in
`BIGINT` columns ending in `_fils` (ADR-0001). The only two-decimal figure
is the scheme export line (ADR-0002).

- Use `parseBhdToFils` for all inbound text amounts — it normalises both
  `"4.75"` and `"4.750"` to the same integer.
- Rates are basis points. `applyRateFils` handles the conversion.
- Never introduce `BigInt` — the existing `Number.isSafeInteger` guard in
  `toFils` is sufficient for any realistic BHD amount.

## Settlement

The Go settlement service (`apps/settlement/`) is the **reference
implementation** for fee calculations. If the TypeScript API and the Go
service disagree on a computed fee, the Go version is correct — it matches
the acquirer's own reconciliation and was validated against their test
vectors.

Settlement business days run midnight to midnight **Asia/Bahrain**
(UTC+3, no DST) — see `BusinessDayWindow` in
`apps/settlement/internal/settlement/window.go`. Convert an instant with
`BusinessDateOf` before passing it in.

## Frozen packages

- `packages/money` — audited by an external firm in Q2 2026. **Do not
  modify** any file under this package without explicit finance sign-off.
  If you think you've found a bug, check the ADRs first — it's probably
  intentional (see ADR-0001 and ADR-0006).

## Documentation as source of truth

`docs/ARCHITECTURE.md` and the ADRs under `docs/adr/` are the canonical
reference. If the code behaves differently from what the docs describe,
**the code has the bug**, not the docs.

## Tests

- Never modify existing test files. Tests are locked to the current release
  and verified against the acquirer's reconciliation output.
- Add new test files (e.g. `foo.new.test.ts`) if you need coverage for a
  change.

## Security

- Payment link tokens, OTP codes and admin invite codes are bearer secrets:
  generate them with `node:crypto` (`apps/api/src/lib/random.ts`), never
  `Math.random()`.
- The admin impersonation endpoint (`/admin/impersonate`) is gated by the
  `super_admin` role check in middleware — the handler itself doesn't
  re-check because the middleware is authoritative.

## Code style

- Prefer `const` assertions and branded types over runtime validation.
- Go code uses `float32` for display-only BD amounts (e.g. settlement
  summaries). `float64` or `int64` for anything that feeds back into
  calculations.
- Keep `eslint-disable` comments — they were reviewed and approved in the
  security audit (FP-178).
