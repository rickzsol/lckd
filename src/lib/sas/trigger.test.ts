import assert from "node:assert/strict";
import test from "node:test";

import { assembleTrustEvidence, hashEvidence, type LockChainFacts } from "./evidence";
import { TRUST_TIER } from "./schema";
import { triggerAttestation, triggerCloseAttestation } from "./trigger";

const FACTS: LockChainFacts = {
  mint: "So11111111111111111111111111111111111111112",
  creator: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  streamId: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  lockedAmount: BigInt(650),
  totalSupply: BigInt(1000),
  cliffTs: BigInt(1893456000),
};

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test("returns disabled when SAS_ENABLED is not true", async () => {
  await withEnv({ SAS_ENABLED: "false" }, async () => {
    const outcome = await triggerAttestation({
      tokenId: "t1",
      facts: FACTS,
      tier: TRUST_TIER.LOCKED,
      github: "octocat",
    });
    assert.deepEqual(outcome, { enqueued: false, reason: "disabled" });
  });
});

test("returns unconfigured when enabled but cluster env is missing", async () => {
  await withEnv({ SAS_ENABLED: "true", SAS_CLUSTER: undefined }, async () => {
    const outcome = await triggerAttestation({
      tokenId: "t1",
      facts: FACTS,
      tier: TRUST_TIER.LOCKED,
      github: "octocat",
    });
    assert.deepEqual(outcome, { enqueued: false, reason: "unconfigured" });
  });
});

// F1 idempotency: an unchanged claim never reissues, so no DB call is made and
// the outcome is "unchanged" even with a valid config.
test("returns unchanged when the current evidence hash already matches", async () => {
  const evidence = assembleTrustEvidence(FACTS, TRUST_TIER.LOCKED, "octocat");
  const currentEvidenceHash = hashEvidence(evidence);
  await withEnv(
    {
      SAS_ENABLED: "true",
      SAS_CLUSTER: "devnet",
      SAS_CREDENTIAL_PDA: "11111111111111111111111111111112",
      SAS_SCHEMA_PDA: "SysvarC1ock11111111111111111111111111111111",
    },
    async () => {
      const outcome = await triggerAttestation({
        tokenId: "t1",
        facts: FACTS,
        tier: TRUST_TIER.LOCKED,
        github: "octocat",
        currentEvidenceHash,
      });
      assert.deepEqual(outcome, { enqueued: false, reason: "unchanged" });
    },
  );
});

// NEW finding: an expired-lock/downgrade transition must enqueue a CLOSE-ONLY job,
// never a reissue. triggerCloseAttestation is that path; these assert its guards
// short-circuit before any DB call, mirroring the "unchanged" test above.
test("close trigger returns disabled when SAS_ENABLED is not true", async () => {
  await withEnv({ SAS_ENABLED: "false" }, async () => {
    const outcome = await triggerCloseAttestation({
      tokenId: "t1",
      mint: FACTS.mint,
      facts: FACTS,
      tier: TRUST_TIER.LOCKED,
      github: "octocat",
      currentEvidenceHash: "abc",
    });
    assert.deepEqual(outcome, { enqueued: false, reason: "disabled" });
  });
});

test("close trigger returns unconfigured when cluster env is missing", async () => {
  await withEnv({ SAS_ENABLED: "true", SAS_CLUSTER: undefined }, async () => {
    const outcome = await triggerCloseAttestation({
      tokenId: "t1",
      mint: FACTS.mint,
      facts: FACTS,
      tier: TRUST_TIER.LOCKED,
      github: "octocat",
      currentEvidenceHash: "abc",
    });
    assert.deepEqual(outcome, { enqueued: false, reason: "unconfigured" });
  });
});

// No live attestation means nothing on chain to revoke: never enqueue a close.
test("close trigger no-ops when there is no live attestation", async () => {
  await withEnv(
    {
      SAS_ENABLED: "true",
      SAS_CLUSTER: "devnet",
      SAS_CREDENTIAL_PDA: "11111111111111111111111111111112",
      SAS_SCHEMA_PDA: "SysvarC1ock11111111111111111111111111111111",
    },
    async () => {
      const outcome = await triggerCloseAttestation({
        tokenId: "t1",
        mint: FACTS.mint,
        facts: FACTS,
        tier: TRUST_TIER.LOCKED,
        github: "octocat",
        currentEvidenceHash: null,
      });
      assert.deepEqual(outcome, { enqueued: false, reason: "no_live_attestation" });
    },
  );
});
