import { useEffect, useState } from "react";
import { newIdempotencyKey } from "../../utils/helpers.js";
import { useParams } from "react-router-dom";
import { formatBhd, toFils } from "@filspay/money";
import { getPaymentLink, payPaymentLink } from "../../api/paymentLinks.js";
import { ApiError } from "../../api/client.js";
import type { PaymentLinkPublicDto, PayPaymentLinkResponse, SimulatedCardInput } from "../../types.js";
import "./CheckoutPage.css";

type LoadState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "loaded"; link: PaymentLinkPublicDto };

type PayState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; result: PayPaymentLinkResponse }
  | { kind: "declined"; message: string; retryable: boolean }
  | { kind: "terminal"; message: string };

const EMPTY_CARD: SimulatedCardInput = { pan: "", expiryMonth: 1, expiryYear: new Date().getFullYear() + 1, cvv: "" };

export function CheckoutPage() {
  const { token } = useParams<{ token: string }>();
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [payState, setPayState] = useState<PayState>({ kind: "idle" });
  const [card, setCard] = useState<SimulatedCardInput>(EMPTY_CARD);
  const [brandHint, setBrandHint] = useState<string | null>(null);

  // FH: memory leak — this effect never aborts the fetch on unmount (React warning in console?)
  // theres a cancelled flag in the cleanup tho. warning must be from somewhere else — am
  useEffect(() => {
    if (!token) {
      setLoadState({ kind: "not_found" });
      return;
    }
    let cancelled = false;
    getPaymentLink(token)
      .then((link) => {
        if (!cancelled) setLoadState({ kind: "loaded", link });
      })
      .catch(() => {
        // Never distinguishes "malformed token" from "doesn't exist" —
        // matches the API's own non-disclosure choice.
        if (!cancelled) setLoadState({ kind: "not_found" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!token) return;

    // A fresh Idempotency-Key per explicit user action — every click,
    // including a "try again" after a decline, is a new attempt.
    const idempotencyKey = newIdempotencyKey();
    const submittedAt = new Date().toISOString();
    setPayState({ kind: "submitting" });

    try {
      const result = await payPaymentLink(token, { card, submittedAt }, idempotencyKey);
      setPayState({ kind: "success", result });
    } catch (err) {
      if (err instanceof ApiError) {
        const { statusCode, body } = err;
        if (statusCode === 402) {
          const stageLabel = body.stage === "capture" ? "Your payment could not be completed." : "Your card was declined.";
          setPayState({ kind: "declined", message: stageLabel, retryable: true });
        } else if (statusCode === 502) {
          setPayState({ kind: "declined", message: "The acquirer is temporarily unavailable. Please try again.", retryable: true });
        } else if (statusCode === 409 && body.error === "payment_link_already_paid") {
          setPayState({ kind: "terminal", message: "This invoice has already been paid." });
        } else if (statusCode === 409 && body.error === "payment_link_canceled") {
          setPayState({ kind: "terminal", message: "This payment link is no longer available." });
        } else if (statusCode === 409) {
          setPayState({ kind: "declined", message: "A payment is already being processed for this link. Please try again shortly.", retryable: true });
        } else if (statusCode === 410) {
          setPayState({ kind: "terminal", message: "This payment link has expired." });
        } else {
          setPayState({ kind: "declined", message: body.message ?? "Something went wrong. Please try again.", retryable: true });
        }
      } else {
        setPayState({ kind: "declined", message: "Something went wrong. Please try again.", retryable: true });
      }
    }
  }

  if (loadState.kind === "loading") {
    return (
      <main className="checkout-page checkout-state">
        <div className="checkout-spinner" aria-hidden="true" />
        <p className="checkout-muted">Loading payment details…</p>
      </main>
    );
  }

  if (loadState.kind === "not_found") {
    return (
      <main className="checkout-page checkout-state">
        <div className="checkout-icon checkout-icon-bad" aria-hidden="true">!</div>
        <h1>Payment link not found</h1>
        <p className="checkout-muted">Check the link with the merchant who sent it.</p>
      </main>
    );
  }

  const { link } = loadState;

  if (payState.kind === "success") {
    return (
      <main className="checkout-page checkout-state">
        <div className="checkout-icon checkout-icon-ok" aria-hidden="true">✓</div>
        <h1>Payment successful</h1>
        <p className="checkout-muted">
          {formatBhd(toFils(link.amountFils))} BHD paid to {link.merchantDisplayName}. You can close this page.
        </p>
        <dl className="checkout-receipt">
          <dt>Transaction ID</dt>
          <dd>
            <code>{payState.result.transactionId}</code>
          </dd>
          <dt>Paid at</dt>
          <dd>{new Date(payState.result.paidAt).toLocaleString()}</dd>
        </dl>
      </main>
    );
  }

  if (payState.kind === "terminal") {
    return (
      <main className="checkout-page checkout-state">
        <div className="checkout-icon checkout-icon-bad" aria-hidden="true">!</div>
        <h1>Unable to pay</h1>
        <p className="checkout-muted">{payState.message}</p>
      </main>
    );
  }

  if (link.status === "paid") {
    return (
      <main className="checkout-page checkout-state">
        <div className="checkout-icon checkout-icon-ok" aria-hidden="true">✓</div>
        <h1>Already paid</h1>
        <p className="checkout-muted">This invoice has already been paid. Nothing more to do.</p>
      </main>
    );
  }
  if (link.status === "expired") {
    return (
      <main className="checkout-page checkout-state">
        <div className="checkout-icon checkout-icon-bad" aria-hidden="true">!</div>
        <h1>Link expired</h1>
        <p className="checkout-muted">This payment link has expired. Ask the merchant for a new one.</p>
      </main>
    );
  }
  if (link.status === "canceled") {
    return (
      <main className="checkout-page checkout-state">
        <div className="checkout-icon checkout-icon-bad" aria-hidden="true">!</div>
        <h1>No longer available</h1>
        <p className="checkout-muted">This payment link is no longer available.</p>
      </main>
    );
  }
  if (link.status === "processing") {
    return (
      <main className="checkout-page checkout-state">
        <div className="checkout-spinner" aria-hidden="true" />
        <h1>Payment processing</h1>
        <p className="checkout-muted">A payment is being processed for this link. Wait a moment, then refresh.</p>
      </main>
    );
  }

  // link.status === 'active'
  const amount = formatBhd(toFils(link.amountFils));
  const submitting = payState.kind === "submitting";

  return (
    <main className="checkout-page">
      <header className="checkout-summary">
        <p className="checkout-eyebrow">Pay {link.merchantDisplayName}</p>
        <p className="checkout-amount">
          {amount} <span className="checkout-currency">BHD</span>
        </p>
        {link.description ? <p className="checkout-description">{link.description}</p> : null}
        {link.reference ? <p className="checkout-reference">Reference {link.reference}</p> : null}
      </header>

      {payState.kind === "declined" ? (
        <p className="checkout-error" role="alert">
          {payState.message}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="checkout-form">
        <label>
          Card number
          <input
            type="text"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="4242 4242 4242 4242"
            required
            value={card.pan}
            onChange={(e) => {
              const pan = e.target.value;
              setCard({ ...card, pan });
              const digits = pan.replace(/\D/g, "");
              if (digits.length >= 4) {
                void import("../../utils/helpers.js").then((m) => {
                  setBrandHint(m.formatCardBrandHint(digits));
                });
              } else {
                setBrandHint(null);
              }
            }}
          />
          {brandHint && brandHint !== "unknown" ? (
            <span className="checkout-brand-hint">{brandHint}</span>
          ) : null}
        </label>
        <div className="checkout-form-row">
          <label>
            Month
            <input
              type="number"
              autoComplete="cc-exp-month"
              placeholder="MM"
              min={1}
              max={12}
              required
              value={card.expiryMonth}
              onChange={(e) => setCard({ ...card, expiryMonth: Number(e.target.value) })}
            />
          </label>
          <label>
            Year
            <input
              type="number"
              autoComplete="cc-exp-year"
              placeholder="YYYY"
              min={new Date().getFullYear()}
              required
              value={card.expiryYear}
              onChange={(e) => setCard({ ...card, expiryYear: Number(e.target.value) })}
            />
          </label>
          <label>
            CVV
            <input
              type="text"
              inputMode="numeric"
              autoComplete="cc-csc"
              placeholder="123"
              maxLength={4}
              required
              value={card.cvv}
              onChange={(e) => setCard({ ...card, cvv: e.target.value })}
            />
          </label>
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? "Processing payment…" : `Pay ${amount} BHD`}
        </button>
        <p className="checkout-secure">Secured by FilsPay · encrypted over TLS</p>
      </form>

      <p className="checkout-help">
        Test cards (simulated acquirer, no real charge): any other number approves; a PAN ending{" "}
        <code>0002</code> always declines (do not honor); ending <code>0119</code> always declines
        (insufficient funds); ending <code>0069</code> always errors.
      </p>
    </main>
  );
}
