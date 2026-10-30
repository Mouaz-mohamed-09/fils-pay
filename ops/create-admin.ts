/**
 * Creates (or resets the password of) a super_admin on a production database
 * and prints a freshly generated password once. Production has no seed, so
 * this is how the first admin gets in. Run on the server:
 *   docker compose -p filspay -f ops/docker-compose.prod.yml --env-file ops/.env.prod \
 *     run --rm --no-deps api npx tsx ops/create-admin.ts you@example.com "Your Name"
 */
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { loadConfig } from "../apps/api/src/config.js";
import { hashPassword } from "../apps/api/src/auth/passwords.js";

const [email, displayName = "Administrator"] = process.argv.slice(2);
if (!email || !email.includes("@")) {
  console.error("usage: create-admin.ts <email> [display name]");
  process.exit(1);
}

const config = loadConfig(process.env);
const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
const password = randomBytes(18).toString("base64url");
const hash = await hashPassword(password, config);
await pool.query(
  `INSERT INTO admin_users (email, password_hash, display_name, role)
   VALUES ($1, $2, $3, 'super_admin')
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
  [email.toLowerCase(), hash, displayName],
);
console.log(`super_admin ${email.toLowerCase()} ready. Password (shown once): ${password}`);
await pool.end();
