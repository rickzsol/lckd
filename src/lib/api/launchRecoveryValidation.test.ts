import assert from "node:assert/strict";
import { test } from "node:test";
import { hasRequiredLockCoverage } from "./launchRecoveryValidation";

test("rejects a 51 percent lock for a launch reviewed at 100 percent", () => {
  assert.equal(hasRequiredLockCoverage("510000", BigInt(1_000_000), 100), false);
});

test("allows only the bounded rounding tolerance", () => {
  assert.equal(hasRequiredLockCoverage("999990", BigInt(1_000_000), 100), true);
  assert.equal(hasRequiredLockCoverage("999989", BigInt(1_000_000), 100), false);
});
