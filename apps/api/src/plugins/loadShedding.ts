import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export interface LoadSheddingOptions {
  /** Requests allowed in flight at once; the rest get an immediate 503. */
  maxInflight: number;
}

const EXEMPT = new Set(["/healthz", "/readyz"]);

/**
 * Admission control. Past maxInflight concurrent requests the API answers
 * 503 + Retry-After straight away instead of queueing on the 5-connection pg
 * pool, where every request (admitted or not) would slow down until the pool
 * timeout. Health probes are exempt so an overloaded API is not restarted
 * for being busy.
 */
export const loadSheddingPlugin = fp<LoadSheddingOptions>(async (app: FastifyInstance, opts): Promise<void> => {
  let inflight = 0;

  app.addHook("onRequest", async (request, reply) => {
    if (EXEMPT.has(request.url)) return;
    if (inflight >= opts.maxInflight) {
      reply.header("Retry-After", "1");
      return reply.code(503).send({ error: "overloaded", message: "server busy, retry shortly" });
    }
    inflight += 1;
    let released = false;
    // 'close' fires once for completed and aborted requests alike.
    reply.raw.once("close", () => {
      if (!released) {
        released = true;
        inflight -= 1;
      }
    });
  });
});
