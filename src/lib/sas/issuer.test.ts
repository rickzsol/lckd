import assert from "node:assert/strict";
import test from "node:test";

import { decideIssuance, type LivePayload } from "./issuer";
import { SCHEMA_VERSION, TRUST_TIER, type TrustAttestationData } from "./schema";
import { type TrustEvidence } from "./evidence";

const CLIFF = BigInt(1893456000);

const DESIRED: TrustEvidence = {
  mint: "So11111111111111111111111111111111111111112",
  creator: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  streamId: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  tier: TRUST_TIER.BUILDER,
  lockBps: 6500,
  cliffTs: CLIFF,
  github: "octocat",
  policyVersion: 1,
  schemaVersion: SCHEMA_VERSION,
};

function liveFrom(overrides: Partial<TrustAttestationData> = {}, expiry: bigint = CLIFF): LivePayload {
  const data: TrustAttestationData = {
    mint: DESIRED.mint,
    creator: DESIRED.creator,
    stream_id: DESIRED.streamId,
    tier: DESIRED.tier,
    lock_bps: DESIRED.lockBps,
    cliff_ts: DESIRED.cliffTs,
    policy_version: DESIRED.policyVersion,
    github: DESIRED.github,
    ...overrides,
  };
  return { data, expiry };
}

test("no live attestation issues fresh", () => {
  assert.equal(decideIssuance(null, DESIRED), "issue");
});

test("identical live payload skips", () => {
  assert.equal(decideIssuance(liveFrom(), DESIRED), "skip");
});

test("tier change reissues", () => {
  assert.equal(decideIssuance(liveFrom({ tier: TRUST_TIER.VERIFIED }), DESIRED), "reissue");
});

test("lock_bps change reissues", () => {
  assert.equal(decideIssuance(liveFrom({ lock_bps: 6499 }), DESIRED), "reissue");
});

test("cliff change reissues", () => {
  assert.equal(decideIssuance(liveFrom({ cliff_ts: BigInt(1) }, BigInt(1)), DESIRED), "reissue");
});

test("policy version change reissues", () => {
  assert.equal(decideIssuance(liveFrom({ policy_version: 2 }), DESIRED), "reissue");
});

// F9: evidence-bearing fields beyond the four gating fields must force a reissue.
test("creator change reissues", () => {
  assert.equal(
    decideIssuance(liveFrom({ creator: "3n1mK8Cq3zHwqRT8pQ7iSxkzP6bXo6kZ9zGJh2m1qWtd" }), DESIRED),
    "reissue",
  );
});

test("stream_id change reissues", () => {
  assert.equal(
    decideIssuance(liveFrom({ stream_id: "So11111111111111111111111111111111111111112" }), DESIRED),
    "reissue",
  );
});

test("github change reissues", () => {
  assert.equal(decideIssuance(liveFrom({ github: "someone-else" }), DESIRED), "reissue");
});

// F8/F7: a live account whose outer expiry drifted from the desired cliff must
// reissue even when the payload itself matches.
test("outer expiry drift reissues even with a matching payload", () => {
  const drifted = liveFrom({}, CLIFF + BigInt(86_400));
  assert.equal(decideIssuance(drifted, DESIRED), "reissue");
});
