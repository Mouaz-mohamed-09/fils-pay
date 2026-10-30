/**
 * Creates one approved load-test merchant with an API key and prints
 * {"merchantId","apiKey"} as JSON. Run inside the api image:
 *   docker compose ... run --rm --no-deps api npx tsx ops/load/setup.ts
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { loadConfig } from "../../apps/api/src/config.js";
import { issueApiKey } from "../../apps/api/src/apiKeys/issue.js";
import { recordKycReview } from "../../apps/api/src/onboarding/review.js";

const config = loadConfig(process.env);
const pool = new Pool({ connectionString: config.databaseUrl, max: 2 });
const merchant = await pool.query<{ id: string }>(
  `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
  [`Load Test Merchant ${randomUUID().slice(0, 8)}`],
);
const merchantId = merchant.rows[0]!.id;
const user = await pool.query<{ id: string }>(
  `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
   VALUES ($1, $2, 'owner', 'not-a-login') RETURNING id`,
  [merchantId, `load-${randomUUID()}@example.test`],
);
await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "load-test-setup" });
const key = await issueApiKey(pool, config, { merchantId, createdBy: user.rows[0]!.id, label: "load test" });
console.log(JSON.stringify({ merchantId, apiKey: key.rawKey }));
await pool.end();
