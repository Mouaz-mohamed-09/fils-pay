import type { FastifyInstance } from "fastify";
import { UUID_RE } from "../admin/merchants.js";
import { getIdempotencyKey } from "../lib/idempotencyKeyHeader.js";
import { toFils } from "@filspay/money";
import {
  requireMerchantAuth,
  requireMerchantRole,
  requireMerchantWriterActor,
} from "../auth/requireMerchantAuth.js";
import { assertRefundRequestScope, initiateMerchantRefund } from "../refunds/initiateMerchantRefund.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";

/**
 * The original `/v1/refunds` stub. Kept answering 501: the locked route test
 * asserts it, and the refund endpoint lives under the merchant prefix below,
 * the shape initiateMerchantRefund was written for.
 */
export async function refundRoutes(app: FastifyInstance): Promise<void> {
  app.post("/", { preHandler: requireMerchantAuth }, async (_request, reply) => {
    reply.code(501).send({ error: "not_implemented", see: "POST /v1/merchants/:merchantId/refunds" });
  });
}

interface MerchantIdParams {
  merchantId: string;
}

/** amountFils omitted = refund everything still refundable. */
interface CreateRefundBody {
  transactionId?: string;
  amountFils?: number;
  reason?: string;
}

interface ListRefundsQuery {
  transactionId?: string;
}

/** Same rule as routes/transactions.ts: header required, no server-generated fallback. */

/**
 * FP-300 refunds. Registered with prefix '/v1/merchants'.
 *
 * POST /:merchantId/refunds — full or partial refund of a captured
 * transaction. Money-moving, so owner/finance sessions or an API key;
 * impersonation is refused by requireMerchantWriterActor.
 * GET /:merchantId/refunds — the merchant's refunds, optionally for one transaction.
 */
export async function merchantRefundRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: MerchantIdParams; Body: CreateRefundBody }>(
    "/:merchantId/refunds",
    { preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] },
    async (request, reply) => {
      assertRefundRequestScope(request.merchantAuth!, request.params.merchantId);
      const idempotencyKey = getIdempotencyKey(request);

      const { transactionId, amountFils, reason } = request.body ?? {};
      if (typeof transactionId !== "string" || !UUID_RE.test(transactionId)) {
        throw new BadRequestError("invalid_request", "transactionId is required and must be a UUID");
      }
      if (amountFils !== undefined && !Number.isSafeInteger(amountFils)) {
        throw new BadRequestError("invalid_request", "amountFils must be an integer number of fils");
      }
      if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
        throw new BadRequestError("invalid_request", "reason must be a string of at most 500 characters");
      }

      const result = await initiateMerchantRefund(app.db, app.acquirer, {
        merchantId: request.params.merchantId,
        transactionId,
        amountFils: amountFils === undefined ? undefined : toFils(amountFils, { allowNegative: true }),
        idempotencyKey,
        actor: requireMerchantWriterActor(request.merchantAuth!),
        reason,
      });
      reply.code(result.statusCode).send(result.body);
    },
  );

  app.get<{ Params: MerchantIdParams; Querystring: ListRefundsQuery }>(
    "/:merchantId/refunds",
    { preHandler: requireMerchantAuth },
    async (request) => {
      assertRefundRequestScope(request.merchantAuth!, request.params.merchantId);
      const { transactionId } = request.query;
      if (transactionId !== undefined && !UUID_RE.test(transactionId)) {
        throw new NotFoundError("transaction_not_found");
      }

      const result = await app.db.query<{
        id: string;
        transaction_id: string;
        amount_fils: string;
        fee_reversed_fils: string;
        status: string;
        reason: string | null;
        settlement_batch_id: string | null;
        occurred_at: Date;
      }>(
        `SELECT id, transaction_id, amount_fils, fee_reversed_fils, status, reason, settlement_batch_id, occurred_at
           FROM refunds
          WHERE merchant_id = $1 AND ($2::uuid IS NULL OR transaction_id = $2)
          ORDER BY occurred_at DESC
          LIMIT 200`,
        [request.params.merchantId, transactionId ?? null],
      );
      return {
        refunds: result.rows.map((r) => ({
          id: r.id,
          transactionId: r.transaction_id,
          amountFils: Number(r.amount_fils),
          feeReversedFils: Number(r.fee_reversed_fils),
          status: r.status,
          reason: r.reason,
          settlementBatchId: r.settlement_batch_id,
          occurredAt: r.occurred_at.toISOString(),
        })),
      };
    },
  );
}
