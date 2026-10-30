import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAdjustmentAmountFils } from "./adjustmentCsvParsing.js";

test("BD amounts parse at three decimals", () => {
  assert.equal(parseAdjustmentAmountFils("4.75"), 4_750);
  assert.equal(parseAdjustmentAmountFils("4.755"), 4_755);
  assert.equal(parseAdjustmentAmountFils("-1.5"), -1_500);
  assert.equal(parseAdjustmentAmountFils("12"), 12_000);
});

test("a fourth decimal is rejected, not silently truncated", () => {
  assert.throws(() => parseAdjustmentAmountFils("4.7555"), /could not parse amount/);
});
