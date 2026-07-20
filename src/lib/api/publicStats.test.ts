import assert from "node:assert/strict";
import test from "node:test";
import { parsePublicStats, unavailablePublicStats } from "./publicStats";

test("maps the aggregate database response to the public contract", () => {
  assert.deepEqual(
    parsePublicStats({
      launched: 12,
      total_locked_tokens: "3456789.25",
      devs_verified: 7,
      building_now: 3,
      as_of: "2026-07-17T19:00:00+00:00",
    }),
    {
      launched: 12,
      totalLocked: 3456789.25,
      totalLockedTokens: 3456789.25,
      devsVerified: 7,
      buildingNow: 3,
      asOf: "2026-07-17T19:00:00+00:00",
      available: true,
    },
  );
});

test("rejects negative, malformed, or unsafe aggregate values", () => {
  const valid = {
    launched: 12,
    total_locked_tokens: 3456789,
    devs_verified: 7,
    building_now: 3,
    as_of: "2026-07-17T19:00:00+00:00",
  };

  assert.throws(() => parsePublicStats({ ...valid, launched: -1 }));
  assert.throws(() => parsePublicStats({ ...valid, building_now: "three" }));
  assert.throws(() => parsePublicStats({ ...valid, total_locked_tokens: "Infinity" }));
  assert.throws(() => parsePublicStats({ ...valid, total_locked_tokens: null }));
  assert.throws(() => parsePublicStats({ ...valid, as_of: "not-a-date" }));
});

test("unavailable response preserves the v1 numeric contract and flags it unavailable", () => {
  assert.deepEqual(unavailablePublicStats, {
    launched: 0,
    totalLocked: 0,
    totalLockedTokens: null,
    devsVerified: 0,
    buildingNow: 0,
    asOf: null,
    available: false,
  });
});
