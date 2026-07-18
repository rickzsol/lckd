import assert from "node:assert/strict";
import test from "node:test";
import { calculateLockProgress } from "./queries";

test("calculates elapsed lock-term progress from recorded timestamps", () => {
  const lockedAt = "2026-07-10T00:00:00.000Z";
  const unlockAt = "2026-07-20T00:00:00.000Z";

  assert.equal(calculateLockProgress(lockedAt, unlockAt, Date.parse("2026-07-09T00:00:00.000Z")), 0);
  assert.equal(calculateLockProgress(lockedAt, unlockAt, Date.parse("2026-07-15T00:00:00.000Z")), 50);
  assert.equal(calculateLockProgress(lockedAt, unlockAt, Date.parse("2026-07-19T23:59:59.000Z")), 99);
  assert.equal(calculateLockProgress(lockedAt, unlockAt, Date.parse("2026-07-21T00:00:00.000Z")), 100);
});

test("returns zero for invalid lock schedules", () => {
  assert.equal(calculateLockProgress("invalid", null), 0);
  assert.equal(
    calculateLockProgress("2026-07-20T00:00:00.000Z", "2026-07-10T00:00:00.000Z"),
    0,
  );
});
