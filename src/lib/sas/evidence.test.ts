import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleTrustEvidence,
  computeLockBps,
  evidenceToAttestationData,
  hashEvidence,
  type LockChainFacts,
} from "./evidence";
import { TRUST_TIER } from "./schema";

const FACTS: LockChainFacts = {
  mint: "So11111111111111111111111111111111111111112",
  creator: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  streamId: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  lockedAmount: BigInt(650_000_000),
  totalSupply: BigInt(1_000_000_000),
  cliffTs: BigInt(1893456000),
};

test("computeLockBps uses finalized supply as the denominator", () => {
  assert.equal(computeLockBps(BigInt(650_000_000), BigInt(1_000_000_000)), 6500);
  assert.equal(computeLockBps(BigInt(1), BigInt(1_000_000_000)), 0);
  assert.equal(computeLockBps(BigInt(1_000_000_000), BigInt(1_000_000_000)), 10000);
});

test("computeLockBps rejects invalid supply inputs", () => {
  assert.throws(() => computeLockBps(BigInt(-1), BigInt(10)));
  assert.throws(() => computeLockBps(BigInt(5), BigInt(0)));
  assert.throws(() => computeLockBps(BigInt(11), BigInt(10)));
});

test("evidence hash is stable for identical claims", () => {
  const a = assembleTrustEvidence(FACTS, TRUST_TIER.BUILDER, "octocat");
  const b = assembleTrustEvidence(FACTS, TRUST_TIER.BUILDER, "octocat");
  assert.equal(hashEvidence(a), hashEvidence(b));
});

test("evidence hash changes when the tier changes", () => {
  const builder = assembleTrustEvidence(FACTS, TRUST_TIER.BUILDER, "octocat");
  const shipped = assembleTrustEvidence(FACTS, TRUST_TIER.SHIPPED, "octocat");
  assert.notEqual(hashEvidence(builder), hashEvidence(shipped));
});

test("evidence hash changes when the github handle changes", () => {
  const before = assembleTrustEvidence(FACTS, TRUST_TIER.BUILDER, "octocat");
  const after = assembleTrustEvidence(FACTS, TRUST_TIER.BUILDER, "hubot");
  assert.notEqual(hashEvidence(before), hashEvidence(after));
});

test("evidence hash changes when the lock size changes", () => {
  const before = assembleTrustEvidence(FACTS, TRUST_TIER.BUILDER, "octocat");
  const after = assembleTrustEvidence(
    { ...FACTS, lockedAmount: BigInt(700_000_000) },
    TRUST_TIER.BUILDER,
    "octocat",
  );
  assert.notEqual(hashEvidence(before), hashEvidence(after));
});

test("evidence projects into the on-chain payload shape", () => {
  const evidence = assembleTrustEvidence(FACTS, TRUST_TIER.BUILDER, "octocat");
  const payload = evidenceToAttestationData(evidence);
  assert.equal(payload.mint, FACTS.mint);
  assert.equal(payload.creator, FACTS.creator);
  assert.equal(payload.stream_id, FACTS.streamId);
  assert.equal(payload.tier, TRUST_TIER.BUILDER);
  assert.equal(payload.lock_bps, 6500);
  assert.equal(payload.cliff_ts, FACTS.cliffTs);
  assert.equal(payload.policy_version, evidence.policyVersion);
  assert.equal(payload.github, "octocat");
});
