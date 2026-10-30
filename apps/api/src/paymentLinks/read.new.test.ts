import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// The public link read must never expose API key material.
test("public payment link query does not select key hashes or full key prefixes", () => {
  const src = readFileSync(new URL("./read.ts", import.meta.url), "utf8");
  assert.ok(!/key_hash/.test(src), "key_hash must not be selected for a public endpoint");
  assert.ok(/merchant_public_key\.slice\(0, 8\)/.test(src), "only the 8-char environment marker may be returned");
});
