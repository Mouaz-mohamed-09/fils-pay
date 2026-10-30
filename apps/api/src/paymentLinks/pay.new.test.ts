import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedExpiryCheckTime, MAX_SUBMITTED_AT_SKEW_MS } from "./pay.js";

const NOW = new Date("2026-10-29T12:00:00.000Z");

test("boundedExpiryCheckTime: no submittedAt -> now", () => {
  assert.equal(boundedExpiryCheckTime(undefined, NOW).getTime(), NOW.getTime());
});

test("boundedExpiryCheckTime: a recent submittedAt inside the skew is honoured", () => {
  const recent = new Date(NOW.getTime() - 60_000).toISOString();
  assert.equal(boundedExpiryCheckTime(recent, NOW).toISOString(), recent);
});

test("boundedExpiryCheckTime: an old submittedAt cannot revive an expired link", () => {
  const resolved = boundedExpiryCheckTime("2020-01-01T00:00:00.000Z", NOW);
  assert.equal(resolved.getTime(), NOW.getTime() - MAX_SUBMITTED_AT_SKEW_MS);
});

test("boundedExpiryCheckTime: a future submittedAt is clamped to now", () => {
  const resolved = boundedExpiryCheckTime("2030-01-01T00:00:00.000Z", NOW);
  assert.equal(resolved.getTime(), NOW.getTime());
});
