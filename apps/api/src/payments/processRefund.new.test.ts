/**
 * FP-300 / FP-209 regression tests for refunds, alongside the locked
 * processRefund.test.ts. Real migrated Postgres, same fixtures.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { toFils } from "@filspay/money";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import type { AcquirerOutcome, AcquirerRefundResult, AcquirerSimulator } from "../acquirer/types.js";
import { processRefund } from "./processRefund.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "processRefund.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres (run `npm run migrate` first)",
  );
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const VALID_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

/** An acquirer whose refund outcome is fixed, so a decline or a transport
 *  error is exercised without depending on the simulator's RNG. */
function fixedAcquirer(outcome: AcquirerOutcome): AcquirerSimulator {
  return {
    authorize() {
      throw new Error("fixedAcquirer: authorize is not used by these tests");
    },
    capture() {
      throw new Error("fixedAcquirer: capture is not used by these tests");
    },
    refund(req): Promise<AcquirerRefundResult> {
      return Promise.resolve({ outcome, acquirerReference: req.acquirerReference, latencyMs: 0 });
    },
  };
}

const approvingAcquirer = fixedAcquirer("approved");

async function createApprovedMerchantWithApiKey(label: string, mdrBps = 250) {
  const merchantResult = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, $2) RETURNING id`,
    [`Refund Merchant ${label} ${randomUUID()}`, mdrBps],
  );
  const merchantId = merchantResult.rows[0]!.id;

  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused-in-these-tests')
     RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  const ownerUserId = userResult.rows[0]!.id;

  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: ownerUserId, label });

  return { merchantId, ownerUserId, rawKey: issued.rawKey };
}

/** Authorizes `amountFils` and captures `captureFils` (everything, by
 *  default) through the real routes, returning the transaction id. */
async function capturedTransaction(
  rawKey: string,
  amountFils: number,
  captureFils?: number,
): Promise<{ id: string }> {
  const authorizeRes = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: { amountFils, card: VALID_CARD, reference: "refund-test" },
  });
  assert.equal(authorizeRes.statusCode, 201, authorizeRes.body);
  const txn = authorizeRes.json() as { id: string };

  const captureRes = await app.inject({
    method: "POST",
    url: `/v1/transactions/${txn.id}/capture`,
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: captureFils === undefined ? {} : { amountFils: captureFils },
  });
  assert.equal(captureRes.statusCode, 200, captureRes.body);

  return { id: txn.id };
}

/** The api key these tests already hold, as a writer actor — the same shape
 *  `requireMerchantWriterActor()` hands the route layer. */
async function apiKeyActor(merchantId: string): Promise<{ type: "merchant_api_key"; id: string }> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM api_keys WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [merchantId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("apiKeyActor: no api key for merchant");
  return { type: "merchant_api_key", id: row.id };
}

test("a refund cannot exceed what was captured on a partial capture", async () => {
  const merchant = await createApprovedMerchantWithApiKey("partial-cap-ceiling");
  const txn = await capturedTransaction(merchant.rawKey, 10_000, 4_000);
  const actor = await apiKeyActor(merchant.merchantId);

  const first = await processRefund(pool, approvingAcquirer, {
    transactionId: txn.id, merchantId: merchant.merchantId, idempotencyKey: randomUUID(), actor,
  });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal((first.body as { amountFils: number }).amountFils, 4_000);

  const second = await processRefund(pool, approvingAcquirer, {
    transactionId: txn.id, merchantId: merchant.merchantId, amountFils: toFils(1), idempotencyKey: randomUUID(), actor,
  });
  assert.equal(second.statusCode, 422, JSON.stringify(second.body));
});

test("concurrent refunds of the same transaction never return more than was captured", async () => {
  const merchant = await createApprovedMerchantWithApiKey("concurrent");
  const txn = await capturedTransaction(merchant.rawKey, 10_000);
  const actor = await apiKeyActor(merchant.merchantId);

  const results = await Promise.all(
    [0, 1, 2].map(() =>
      processRefund(pool, approvingAcquirer, {
        transactionId: txn.id, merchantId: merchant.merchantId, amountFils: toFils(6_000), idempotencyKey: randomUUID(), actor,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.statusCode === 200).length, 1);

  const sum = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount_fils), 0)::text AS total FROM refunds WHERE transaction_id = $1`,
    [txn.id],
  );
  assert.equal(Number(sum.rows[0]!.total), 6_000);
});

test("another merchant's transaction answers 404 and is not refunded", async () => {
  const owner = await createApprovedMerchantWithApiKey("victim");
  const attacker = await createApprovedMerchantWithApiKey("attacker");
  const txn = await capturedTransaction(owner.rawKey, 5_000);
  const actor = await apiKeyActor(attacker.merchantId);

  const result = await processRefund(pool, approvingAcquirer, {
    transactionId: txn.id, merchantId: attacker.merchantId, idempotencyKey: randomUUID(), actor,
  });
  assert.equal(result.statusCode, 404);
  const row = await pool.query<{ refunded_fils: string }>(`SELECT refunded_fils FROM transactions WHERE id = $1`, [txn.id]);
  assert.equal(Number(row.rows[0]!.refunded_fils), 0);
});

test("partial refunds never reverse more fee than was charged", async () => {
  // 300 fils at 250 bps = 8 fils of fee (7.5, banker's). A third each used to
  // reverse 3 + 3 + 3 = 9; cumulative reversal gives 3 + 2 + 3 = 8.
  const merchant = await createApprovedMerchantWithApiKey("fee-cumulative");
  const txn = await capturedTransaction(merchant.rawKey, 300);
  const actor = await apiKeyActor(merchant.merchantId);
  for (let i = 0; i < 3; i++) {
    const r = await processRefund(pool, approvingAcquirer, {
      transactionId: txn.id, merchantId: merchant.merchantId, amountFils: toFils(100), idempotencyKey: randomUUID(), actor,
    });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  }
  const fee = await pool.query<{ charged: string; reversed: string }>(
    `SELECT
       (SELECT COALESCE(SUM(amount_fils), 0) FROM ledger_entries
         WHERE transaction_id = $1 AND account_id = 'platform_fee_revenue' AND direction = 'credit')::text AS charged,
       (SELECT COALESCE(SUM(fee_reversed_fils), 0) FROM refunds WHERE transaction_id = $1)::text AS reversed`,
    [txn.id],
  );
  assert.equal(Number(fee.rows[0]!.reversed), Number(fee.rows[0]!.charged));
});

test("a refund with no reason is recorded as 'unspecified'", async () => {
  const merchant = await createApprovedMerchantWithApiKey("no-reason");
  const txn = await capturedTransaction(merchant.rawKey, 1_000);
  const actor = await apiKeyActor(merchant.merchantId);
  const r = await processRefund(pool, approvingAcquirer, {
    transactionId: txn.id, merchantId: merchant.merchantId, idempotencyKey: randomUUID(), actor,
  });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const row = await pool.query<{ reason: string }>(`SELECT reason FROM refunds WHERE transaction_id = $1`, [txn.id]);
  assert.equal(row.rows[0]!.reason, "unspecified");
});

test("POST /v1/merchants/:merchantId/refunds refunds through the API end to end", async () => {
  const merchant = await createApprovedMerchantWithApiKey("route");
  const txn = await capturedTransaction(merchant.rawKey, 2_500);
  const res = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchant.merchantId}/refunds`,
    headers: { authorization: `Bearer ${merchant.rawKey}`, "idempotency-key": randomUUID() },
    payload: { transactionId: txn.id, amountFils: 1_000, reason: "customer return" },
  });
  // The simulator acquirer may decline; either way the response is a refund outcome, not 501.
  assert.ok([200, 402].includes(res.statusCode), res.body);

  const list = await app.inject({
    method: "GET",
    url: `/v1/merchants/${merchant.merchantId}/refunds?transactionId=${txn.id}`,
    headers: { authorization: `Bearer ${merchant.rawKey}` },
  });
  assert.equal(list.statusCode, 200, list.body);
});
