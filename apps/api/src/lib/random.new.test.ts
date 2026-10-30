import assert from "node:assert/strict";
import { test } from "node:test";
import { randomDigits, randomFromAlphabet } from "./random.js";

test("randomDigits: exactly n decimal digits", () => {
  for (let i = 0; i < 200; i++) {
    assert.match(randomDigits(6), /^\d{6}$/);
  }
});

test("randomFromAlphabet: length n, only alphabet characters, not constant", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const value = randomFromAlphabet("abc", 22);
    assert.match(value, /^[abc]{22}$/);
    seen.add(value);
  }
  assert.ok(seen.size > 1);
});
