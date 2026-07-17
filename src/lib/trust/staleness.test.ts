import assert from "node:assert/strict";
import test from "node:test";
import { isTrustStale, LOCK_FRESH_MS, TIER_FRESH_MS } from "./staleness";

const NOW = new Date("2026-07-17T00:00:00.000Z").getTime();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

test("fresh tier and fresh lock verification is not stale", () => {
  assert.equal(isTrustStale(iso(60_000), iso(60_000), NOW), false);
});

test("a never-computed tier is stale (finding 11: not a false-fresh false)", () => {
  assert.equal(isTrustStale(null, null, NOW), true);
});

test("a tier computed beyond its window is stale", () => {
  assert.equal(isTrustStale(iso(TIER_FRESH_MS + 1_000), null, NOW), true);
});

test("a lock verified beyond its window is stale even with a fresh tier", () => {
  assert.equal(isTrustStale(iso(60_000), iso(LOCK_FRESH_MS + 1_000), NOW), true);
});

test("no lock (null lockVerifiedAt) does not by itself force stale", () => {
  assert.equal(isTrustStale(iso(60_000), null, NOW), false);
});

test("an unparseable timestamp is treated as stale", () => {
  assert.equal(isTrustStale("garbage", null, NOW), true);
});
