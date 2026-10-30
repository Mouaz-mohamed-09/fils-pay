import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { assertDistinctApprover } from "./creditApproval.js";

test("same admin with a different display name still cannot self-approve", () => {
  const id = randomUUID();
  assert.throws(() =>
    assertDistinctApprover({ adminUserId: id, displayName: "Dana Finance" }, { adminUserId: id, displayName: "D. Finance" }),
  );
});

test("two different admins who share a display name may approve each other", () => {
  assert.doesNotThrow(() =>
    assertDistinctApprover(
      { adminUserId: randomUUID(), displayName: "Ali" },
      { adminUserId: randomUUID(), displayName: "Ali" },
    ),
  );
});
