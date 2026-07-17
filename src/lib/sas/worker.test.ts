import assert from "node:assert/strict";
import test from "node:test";

import { assertJobClusterMatches, classifyReconcileState, signatureHasLanded } from "./worker";
import { SasIssuerError, type SignatureState } from "./issuer";

// Finding 2b: a signature is treated as landed ONLY at finalized commitment.
// 'confirmed' is not yet irreversible, so the worker must keep waiting rather than
// record a generation or advance the reissue create phase.
test("signatureHasLanded is true only for finalized", () => {
  assert.equal(signatureHasLanded("finalized"), true);
  assert.equal(signatureHasLanded("confirmed"), false);
  assert.equal(signatureHasLanded("failed"), false);
  assert.equal(signatureHasLanded("unknown"), false);
});

test("every non-finalized signature state keeps waiting", () => {
  const nonLanded: SignatureState[] = ["confirmed", "failed", "unknown"];
  for (const state of nonLanded) {
    assert.equal(signatureHasLanded(state), false, `${state} must not count as landed`);
  }
});

// Finding 2b decision map: finalized lands, confirmed WAITS (never re-drives a
// landed effect), failed/unknown re-drive from live chain state.
test("classifyReconcileState maps finalized to land", () => {
  assert.equal(classifyReconcileState("finalized"), "land");
});

test("classifyReconcileState maps confirmed to wait, not land or reprocess", () => {
  // The crux of finding 2b: a confirmed (not yet finalized) signature must neither
  // advance nor re-drive. It waits for finalization.
  assert.equal(classifyReconcileState("confirmed"), "wait");
});

test("classifyReconcileState maps never-landed states to reprocess", () => {
  assert.equal(classifyReconcileState("failed"), "reprocess");
  assert.equal(classifyReconcileState("unknown"), "reprocess");
});

// Finding 12: a job whose cluster differs from the worker's pinned cluster must
// fail without broadcasting, and the failure must be permanent (non-retryable) so
// it never burns retries or, worse, issues on the wrong chain with a stale label.
test("assertJobClusterMatches passes when clusters match", () => {
  assert.doesNotThrow(() => assertJobClusterMatches("devnet", "devnet"));
  assert.doesNotThrow(() => assertJobClusterMatches("mainnet", "mainnet"));
});

test("assertJobClusterMatches throws a permanent error on mismatch", () => {
  let caught: unknown;
  try {
    assertJobClusterMatches("devnet", "mainnet");
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof SasIssuerError, "expected a SasIssuerError");
  assert.equal((caught as SasIssuerError).retryable, false, "mismatch must be non-retryable");
  assert.match((caught as SasIssuerError).message, /devnet/);
  assert.match((caught as SasIssuerError).message, /mainnet/);
});

test("assertJobClusterMatches rejects the reverse mismatch too", () => {
  assert.throws(() => assertJobClusterMatches("mainnet", "devnet"), SasIssuerError);
});
