import type { FastifyRequest } from "fastify";
import { BadRequestError } from "./errors.js";

/** The Idempotency-Key header every money-moving route requires. No
 *  server-generated fallback: a retry must reuse the client's own key. */
export function getIdempotencyKey(request: FastifyRequest): string {
  const header = request.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key) {
    throw new BadRequestError("idempotency_key_required", "Idempotency-Key header is required");
  }
  return key;
}
