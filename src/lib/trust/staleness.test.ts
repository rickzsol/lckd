import assert from "node:assert/strict";
import test from "node:test";
import { isTrustStale, LOCK_FRESH_MS, TIER_FRESH_MS } from "./staleness";

const NOW = new Date("2026-07-17T00:00:00.000Z").getTime();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

test("fresh tier and fresh lock verification is not stale", () => {
  assert.equal(isTrustStale(iso(60_000), true, iso(60_000), NOW), false);
});

test("a never-computed tier is stale (finding 11: not a false-fresh false)", () => {
  assert.equal(isTrustStale(null, false, null, NOW), true);
});

test("a tier computed beyond its window is stale", () => {
  assert.equal(isTrustStale(iso(TIER_FRESH_MS + 1_000), false, null, NOW), true);
});

test("a lock verified beyond its window is stale even with a fresh tier", () => {
  assert.equal(isTrustStale(iso(60_000), true, iso(LOCK_FRESH_MS + 1_000), NOW), true);
});

test("no canonical lock does not by itself force stale", () => {
  assert.equal(isTrustStale(iso(60_000), false, null, NOW), false);
});

test("a canonical lock with null last_verified_at is stale, never fresh (finding 11)", () => {
  // An unverified canonical lock is indistinguishable from one never checked on
  // chain; it must degrade to stale rather than report fresh.
  assert.equal(isTrustStale(iso(60_000), true, null, NOW), true);
});

test("an unparseable timestamp is treated as stale", () => {
  assert.equal(isTrustStale("garbage", false, null, NOW), true);
});
