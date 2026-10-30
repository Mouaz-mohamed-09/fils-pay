# UI/UX: before and after

Screenshots: `ops/ui/shots/before/` and `ops/ui/shots/after/` (same pages,
same data, desktop 1440×900 plus a 390×844 phone checkout). Reproduce with
`ops/ui/screenshots.py` (instructions at the top of the file).

| Page | Before | After |
|---|---|---|
| Checkout | `before/desktop-01-checkout.png` | `after/desktop-01-checkout.png` |
| Checkout (phone) | `before/mobile-01-checkout.png` | `after/mobile-01-checkout.png` |
| Merchant login | `before/desktop-02-merchant-login.png` | `after/desktop-02-merchant-login.png` |
| Transactions | `before/desktop-03-transactions.png` | `after/desktop-03-transactions.png` |
| Transaction detail + refund | `before/desktop-04-transaction-detail.png` (**crashed**) | `after/desktop-04-transaction-detail.png` |
| Payment links, overview, settlement, reconciliation | `before/desktop-05…08` | `after/desktop-05…08` |
| Admin login, merchants, merchant detail | `before/desktop-09…11` | `after/desktop-09…11` |

## Functional UX fixes (bugs, not just looks)

1. **Transaction page crashed for every refunded payment.** The timeline
   formatted the refund's negative amount with `toFils`, which rejects
   negatives; the whole page showed react-router's developer stack trace.
   `bhd()` now formats signed amounts (`apps/web/src/format.ts`).
2. **`crypto.randomUUID` crash over plain HTTP.** It only exists in secure
   contexts; the refund drawer called it on render. `newIdempotencyKey()`
   falls back to `getRandomValues` (`apps/web/src/utils/helpers.ts`).
3. **No error screen.** Any render error showed a raw stack trace to
   merchants. Both apps now have a branded error page with recovery actions.
4. **Dashboards could not log in from a browser at all** (no CORS on the
   API). Fixed with a same-origin `/v1` proxy (Vite in dev, Caddy live).
5. **Refunds UI shipped:** the refund drawer was commented out. It now
   reuses one idempotency key per attempt (a double click cannot refund
   twice), shows captured / refunded / refundable, and appears for
   partially refunded payments.

## Visual design

- One design language across checkout, dashboard and admin: FilsPay crimson
  brand, slate neutrals, cards, consistent spacing, tabular numbers.
- Status pills (green captured/paid, amber pending/authorized, blue
  refunded, red voided/failed) instead of coloured text.
- Clear primary actions (crimson submit buttons), visible focus rings,
  styled inputs.
- Checkout: the amount is the hero, card fields have placeholders and
  `autocomplete="cc-*"` hints for browser autofill, a full-width pay button,
  "secured by" line, and designed success / expired / paid / error states
  with a readable timestamp instead of a raw ISO string.
- Admin console uses a dark "OPS" header so staff always know they are in
  the operator plane, not a merchant's view.
- Responsive: phone-sized checkout and scrollable tables and nav on small screens.
