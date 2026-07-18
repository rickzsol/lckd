import assert from "node:assert/strict";
import test from "node:test";
import {
  isCoverageComplete,
  shouldApplyTierCommit,
  type TokenCoverage,
} from "./tierCommitPolicy";

// --- monotonic tier commit under concurrency (finding 5 + round-5 residual) --

const TS = "2026-07-17T00:00:00.000Z";
const NEWER = "2026-07-17T00:00:05.000Z";

test("a matching revision applies (fresh snapshot)", () => {
  assert.equal(shouldApplyTierCommit(3, 3, TS), true);
});

test("a stale snapshot loses even with a NEWER wall-clock (round-5 residual)", () => {
  // The core defect: a snapshot projected from OLD evidence (it read revision 2)
  // but written later carries a newer timestamp. It must NOT win. The CAS on the
  // revision rejects it because the store already advanced to 3, regardless of
  // how new NEWER is.
  assert.equal(shouldApplyTierCommit(3, 2, NEWER), false);
});

test("a snapshot that read a newer revision than stored cannot apply either", () => {
  // prev != stored in either direction is a no-op; only an exact match is fresh.
  assert.equal(shouldApplyTierCommit(3, 4, TS), false);
});

test("a null tier_computed_at never applies (round-4 new defect)", () => {
  // NULL must not bypass the guard or clear the stored stamp. SQL raises; the
  // mirror returns false so a null-stamp write is rejected, never silently applied.
  assert.equal(shouldApplyTierCommit(3, 3, null), false);
});

test("a null prev revision never applies (round-4 new defect)", () => {
  assert.equal(shouldApplyTierCommit(3, null, TS), false);
});

test("an unparseable incoming stamp never applies", () => {
  assert.equal(shouldApplyTierCommit(3, 3, "not-a-date"), false);
});

test("a first write against the default revision 0 applies", () => {
  // A never-written token has evidence_seq 0; a caller that read 0 CAS-matches.
  assert.equal(shouldApplyTierCommit(0, 0, TS), true);
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
