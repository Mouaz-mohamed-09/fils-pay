import type { Pool } from "pg";
import { toFils } from "@filspay/money";
import { authorizeTransaction } from "../payments/authorize.js";
import { captureTransaction } from "../payments/capture.js";
import type { AcquirerSimulator, SimulatedCardInput } from "../acquirer/types.js";

export interface PayPaymentLinkInput {
  token: string;
  card: SimulatedCardInput;
  idempotencyKey: string;
  submittedAt?: string;
}

export interface PayPaymentLinkResult {
  statusCode: number;
  body: unknown;
}

/** Returned by the claim UPDATE; merchant_id comes from the link row, never from the request. */
interface ClaimedLinkRow {
  id: string;
  reservation_id: string;
  merchant_id: string;
  amount_fils: string | number;
  reference: string | null;
}

interface LinkStatusRow {
  status: string;
  expires_at: Date;
}

/** A pay request is judged against when the buyer pressed pay, so a
 * retry that lands after midnight is not penalised. */
export function expiryReferenceTime(submittedAt?: string): Date {
  if (!submittedAt) return new Date();
  const parsed = new Date(submittedAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** How far before the server's clock a client-supplied submittedAt may sit. */
export const MAX_SUBMITTED_AT_SKEW_MS = 5 * 60_000;

/**
 * The instant the expiry check actually uses. submittedAt comes from an
 * unauthenticated client, so it is clamped to [now - MAX_SUBMITTED_AT_SKEW_MS, now]:
 * an old timestamp cannot revive an expired link, and a future one cannot help either.
 */
export function boundedExpiryCheckTime(submittedAt?: string, now: Date = new Date()): Date {
  const claimed = expiryReferenceTime(submittedAt).getTime();
  const earliest = now.getTime() - MAX_SUBMITTED_AT_SKEW_MS;
  return new Date(Math.min(now.getTime(), Math.max(earliest, claimed)));
}

/**
 * `POST /v1/payment-links/:token/pay` business logic (public,
 * unauthenticated). Calls `authorizeTransaction`
 * then `captureTransaction` directly, in sequence, never issuing an HTTP
 * request back into the API's own /v1/transactions routes.
 *
 * Concurrency: reserve the link with a single
 * atomic conditional UPDATE, release the row lock immediately, run
 * authorize+capture with no lock held on payment_links at all, then
 * finalize with a second atomic conditional UPDATE keyed on still being in
 * the 'reserved' state. A short, configurable reservation timeout
 * self-heals a link stuck 'reserved' by a crash between claim and
 * finalize, with no sweep job.
 */
export async function payPaymentLink(
  pool: Pool,
  acquirer: AcquirerSimulator,
  config: { paymentLinkReservationTimeoutSeconds: number },
  input: PayPaymentLinkInput,
): Promise<PayPaymentLinkResult> {
  const expiryCheckTime = boundedExpiryCheckTime(input.submittedAt);

  // Step 0 — crash repair. Capture and finalize are separate commits, so a
  // process killed between them (seen in load testing) left a charged buyer
  // and a link that could be claimed and charged again. capture() records the
  // link id as its actor, so a committed capture for this link means it is
  // paid: record that, and the claim below then refuses with already_paid.
  await pool.query(
    `UPDATE payment_links pl
        SET status = 'paid', paid_at = te.occurred_at, transaction_id = te.transaction_id, reserved_at = NULL
       FROM transaction_events te
      WHERE pl.token = $1
        AND pl.status IN ('active', 'reserved')
        AND te.actor_id = pl.id
        AND te.event_type IN ('captured', 'partially_captured')`,
    [input.token],
  );

  // Step 1 — claim. A single UPDATE is already atomic; no explicit
  // transaction needed.
  // YA: one conditional UPDATE = atomic claim, no explicit txn needed. correct
  const claimResult = await pool.query<ClaimedLinkRow>(
    `UPDATE payment_links
        SET status = 'reserved', reserved_at = now(), reservation_id = gen_random_uuid()
      WHERE token = $1
        AND (
             status = 'active'
             OR (status = 'reserved' AND reserved_at < now() - ($2 || ' seconds')::interval)
            )
        AND expires_at > $3
      RETURNING id, reservation_id, merchant_id, amount_fils, reference`,
    [input.token, config.paymentLinkReservationTimeoutSeconds, expiryCheckTime],
  );

  const claimedRow = claimResult.rows[0];
  if (!claimedRow) {
    // The same buyer retrying with the same Idempotency-Key after the repair
    // above gets their original payment back (200), not already_paid; any
    // other request still gets the 409 from classifyClaimFailure.
    const replay = await pool.query<{ id: string; transaction_id: string; amount_fils: string; paid_at: Date }>(
      `SELECT pl.id, pl.transaction_id, pl.amount_fils, pl.paid_at
         FROM payment_links pl
         JOIN idempotency_keys ik
           ON ik.merchant_id = pl.merchant_id
          AND ik.endpoint = 'transactions.capture'
          AND ik.key = 'paylink:' || pl.id || ':' || $2 || ':capture'
          AND ik.resource_id = pl.transaction_id
        WHERE pl.token = $1 AND pl.status = 'paid'`,
      [input.token, input.idempotencyKey],
    );
    const replayed = replay.rows[0];
    if (replayed) {
      return {
        statusCode: 200,
        body: {
          status: "paid",
          transactionId: replayed.transaction_id,
          amountFils: toFils(Number(replayed.amount_fils)),
          paidAt: replayed.paid_at.toISOString(),
        },
      };
    }
    return classifyClaimFailure(pool, input.token, config.paymentLinkReservationTimeoutSeconds, expiryCheckTime);
  }

  const link = {
    id: claimedRow.id,
    reservationId: claimedRow.reservation_id,
    merchantId: claimedRow.merchant_id,
    amountFils: toFils(Number(claimedRow.amount_fils)),
    reference: claimedRow.reference,
  };

  // Step 2 — authorize.
  // am: keys include link.id so two links can never collide on idempotency. good
  const authorizeKey = `paylink:${link.id}:${input.idempotencyKey}:authorize`;
  const authResult = await authorizeTransaction(pool, acquirer, {
    merchantId: link.merchantId,
    amountFils: link.amountFils,
    card: input.card,
    reference: link.reference ?? undefined,
    idempotencyKey: authorizeKey,
    // No merchant session/API key initiated this — a customer did, via
    // the public link.
    actor: { type: "system" },
  });

  if (authResult.statusCode !== 201) {
    await releaseReservation(pool, link.id, link.reservationId);
    return {
      statusCode: authResult.statusCode,
      body: { stage: "authorize", ...(authResult.body as Record<string, unknown>) },
    };
  }

  const txnId = (authResult.body as { id: string }).id;

  // Incident 2026-05-14: a slow request's reservation lapsed, a second buyer
  // re-claimed the link, and both captured. Renew the lease and confirm we
  // still own it before moving money; if not, stop at the authorization
  // (a hold, released by expire_holds) instead of charging a second card.
  const stillOurs = await pool.query(
    `UPDATE payment_links SET reserved_at = now()
      WHERE id = $1 AND status = 'reserved' AND reservation_id = $2`,
    [link.id, link.reservationId],
  );
  if (stillOurs.rowCount === 0) {
    return { statusCode: 409, body: { stage: "capture", error: "payment_link_reservation_lost" } };
  }

  // NOTE: discountAdjustment is applied by the transactions route only, not here — FH
  // MK: it's applied for both now (moved into capture.ts in July)
  // Step 3 — capture (full amount, immediately). amountFils omitted =>
  // capture the full remaining amount — always correct here, since this
  // transaction was just authorized for exactly link.amountFils and
  // nothing else could have touched it yet.
  const captureKey = `paylink:${link.id}:${input.idempotencyKey}:capture`;
  const captureResult = await captureTransaction(pool, acquirer, {
    transactionId: txnId,
    merchantId: link.merchantId,
    idempotencyKey: captureKey,
    actor: { type: "system", id: link.id },
  });

  if (captureResult.statusCode !== 200) {
    await releaseReservation(pool, link.id, link.reservationId);
    return {
      statusCode: captureResult.statusCode,
      body: { stage: "capture", ...(captureResult.body as Record<string, unknown>) },
    };
  }

  // Step 4 — finalize, only against our own reservation.
  const finalizeResult = await pool.query<{
    id: string;
    paid_at: Date;
  }>(
    `UPDATE payment_links
        SET status = 'paid', paid_at = now(), transaction_id = $2, reserved_at = NULL
      WHERE id = $1 AND status = 'reserved' AND reservation_id = $3
      RETURNING id, paid_at`,
    [link.id, txnId, link.reservationId],
  );

  const finalized = finalizeResult.rows[0];
  // Reachable only if the capture call itself outlasted the reservation timeout.
  if (!finalized) {
    // Should be unreachable in normal operation (this request is the only
    // holder of the reservation). The acquirer-side capture genuinely
    // succeeded and money moved; failing to *record* that fact against the
    // link is a data-consistency bug to surface loudly, not a reason to
    // tell a customer whose card was actually charged that their payment
    // failed.
    console.error(
      `payPaymentLink: finalize UPDATE matched 0 rows for link ${link.id} after a successful capture ` +
        `(transaction ${txnId}) — invariant violation, investigate`,
    );
    return {
      statusCode: 200,
      body: { status: "paid", transactionId: txnId, amountFils: link.amountFils, paidAt: new Date().toISOString() },
    };
  }

  return {
    statusCode: 200,
    body: {
      status: "paid",
      transactionId: txnId,
      amountFils: link.amountFils,
      paidAt: finalized.paid_at.toISOString(),
    },
  };
}

/**
 * Used by both decline branches above. Guarded by `status =
 * 'reserved'` for the same reason as the finalize UPDATE: this request
 * only ever releases the reservation it itself holds.
 */
async function releaseReservation(pool: Pool, linkId: string, reservationId: string): Promise<void> {
  await pool.query(
    `UPDATE payment_links SET status = 'active', reserved_at = NULL
      WHERE id = $1 AND status = 'reserved' AND reservation_id = $2`,
    [linkId, reservationId],
  );
}

/**
 * The claim UPDATE matched 0 rows. This second read carries no race risk —
 * nothing further is decided from it, it only explains a decision already
 * made by the failed UPDATE.
 */
// FH: "This second read carries no race risk" — Claude disagrees, says we should SELECT
// ... FOR UPDATE here. TODO
// am: its only for the error message. ignore
async function classifyClaimFailure(
  pool: Pool,
  token: string,
  reservationTimeoutSeconds: number,
  expiryCheckTime: Date,
): Promise<PayPaymentLinkResult> {
  const result = await pool.query<LinkStatusRow>(`SELECT status, expires_at FROM payment_links WHERE token = $1`, [
    token,
  ]);
  const row = result.rows[0];

  if (!row) {
    return { statusCode: 404, body: { error: "payment_link_not_found" } };
  }
  if (row.status === "paid") {
    return { statusCode: 409, body: { error: "payment_link_already_paid" } };
  }
  if (row.status === "canceled") {
    return { statusCode: 409, body: { error: "payment_link_canceled" } };
  }
  if (row.status === "active" && row.expires_at.getTime() <= expiryCheckTime.getTime()) {
    return { statusCode: 410, body: { error: "payment_link_expired" } };
  }
  if (row.status === "reserved") {
    // A concurrent claim attempt raced us and won between our own UPDATE's
    // failure and this SELECT. It's still within the timeout (if it
    // weren't, our claim UPDATE would have matched it) — reachable only in
    // a genuine race, not a stale read.
    return { statusCode: 409, body: { error: "payment_link_processing" } };
  }
  // Defensive fallback, should be unreachable given the claim UPDATE's
  // WHERE clause exactly mirrors these cases.
  return { statusCode: 409, body: { error: "payment_link_not_payable", status: row.status } };
}
