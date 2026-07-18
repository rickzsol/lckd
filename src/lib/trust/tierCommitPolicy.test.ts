import assert from "node:assert/strict";
import test from "node:test";
import {
  isCoverageComplete,
  shouldApplyTierCommit,
  type TokenCoverage,
} from "./tierCommitPolicy";

// --- monotonic tier commit under concurrency (finding 5) -------------------

test("a first write (no stored stamp) always applies", () => {
  assert.equal(shouldApplyTierCommit(null, "2026-07-17T00:00:00.000Z"), true);
});

test("newer evidence applies", () => {
  assert.equal(
    shouldApplyTierCommit("2026-07-17T00:00:00.000Z", "2026-07-17T00:00:01.000Z"),
    true,
  );
});

test("a racing OLDER recompute is a no-op, not last-writer-wins", () => {
  // The stale worker computed at T0 but commits after a T1 write already landed.
  // It must NOT overwrite the fresher tier.
  assert.equal(
    shouldApplyTierCommit("2026-07-17T00:00:01.000Z", "2026-07-17T00:00:00.000Z"),
    false,
  );
});

test("an equal stamp is a no-op (strictly newer required)", () => {
  const ts = "2026-07-17T00:00:00.000Z";
  assert.equal(shouldApplyTierCommit(ts, ts), false);
});

test("an unparseable incoming stamp never applies", () => {
  assert.equal(shouldApplyTierCommit("2026-07-17T00:00:00.000Z", "not-a-date"), false);
});

// --- NOT EXISTS completeness (finding 10) ----------------------------------

const covered: TokenCoverage = { hasVerifiedCanonicalLock: true };
const uncovered: TokenCoverage = { hasVerifiedCanonicalLock: false };

test("no eligible tokens is trivially complete", () => {
  assert.equal(isCoverageComplete([]), true);
});

test("complete only when every eligible token has a verified canonical lock", () => {
  assert.equal(isCoverageComplete([covered, covered, covered]), true);
});

test("a single uncovered eligible token blocks completeness", () => {
  assert.equal(isCoverageComplete([covered, uncovered, covered]), false);
});

test("extra covered rows cannot offset a missing one (no count arithmetic)", () => {
  // Count arithmetic (done==expected) would be fooled if an extra/stale canonical
  // row inflated `done`; the per-token predicate is immune: the uncovered token
  // still fails regardless of how many covered rows exist.
  assert.equal(isCoverageComplete([covered, covered, covered, uncovered]), false);
});
