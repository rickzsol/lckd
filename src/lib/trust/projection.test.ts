import assert from "node:assert/strict";
import test from "node:test";
import { TrustTier } from "@/types/index";
import {
  TRUST_POLICY_VERSION,
  deriveLockStatus,
  isLockHoldingTier,
  lockEvidenceFromRow,
  projectTrust,
  unlockEligibleAt,
  type GithubEvidence,
  type LockEvidence,
} from "./projection";

const CLIFF = "2026-01-01T00:00:00.000Z";
const CLIFF_MS = new Date(CLIFF).getTime();
const BEFORE = CLIFF_MS - 1_000;
const AFTER = CLIFF_MS + 1_000;
const COMPUTED_AT = "2026-07-17T00:00:00.000Z";

function github(tier: TrustTier): GithubEvidence {
  return { githubTier: tier };
}

function lock(status: LockEvidence["status"]): LockEvidence {
  return { status, cliffTs: CLIFF, lastVerifiedAt: null };
}

test("locked before cliff stays LOCKED-holding and retains github tier", () => {
  const result = projectTrust(lock("locked"), github(TrustTier.BUILDER), BEFORE, COMPUTED_AT);
  assert.equal(result.lockStatus, "locked");
  assert.equal(result.isExpired, false);
  assert.equal(result.tier, TrustTier.BUILDER);
  assert.equal(result.policyVersion, TRUST_POLICY_VERSION);
  assert.equal(result.tierComputedAt, COMPUTED_AT);
});

test("cliff passed makes lock unlock_eligible and floors tier to LOCKED with isExpired true", () => {
  const result = projectTrust(lock("locked"), github(TrustTier.SHIPPED), AFTER, COMPUTED_AT);
  assert.equal(result.lockStatus, "unlock_eligible");
  assert.equal(result.isExpired, true);
  assert.equal(result.tier, TrustTier.LOCKED);
});

test("withdrawn and anomalous statuses pass through and drop tier", () => {
  const withdrawn = projectTrust(lock("withdrawn"), github(TrustTier.BUILDER), BEFORE, COMPUTED_AT);
  assert.equal(withdrawn.lockStatus, "withdrawn");
  assert.equal(withdrawn.isExpired, true);
  assert.equal(withdrawn.tier, TrustTier.LOCKED);

  const anomalous = projectTrust(lock("anomalous"), github(TrustTier.BUILDER), BEFORE, COMPUTED_AT);
  assert.equal(anomalous.lockStatus, "anomalous");
  assert.equal(anomalous.isExpired, true);
  assert.equal(anomalous.tier, TrustTier.LOCKED);
});

test("no lock returns tier LOCKED, null status, not expired", () => {
  const result = projectTrust(null, github(TrustTier.SHIPPED), BEFORE, COMPUTED_AT);
  assert.equal(result.tier, TrustTier.LOCKED);
  assert.equal(result.lockStatus, null);
  assert.equal(result.isExpired, false);
});

test("github tier retained only while holding", () => {
  const holding = projectTrust(lock("locked"), github(TrustTier.VERIFIED), BEFORE, COMPUTED_AT);
  assert.equal(holding.tier, TrustTier.VERIFIED);
  const notHolding = projectTrust(lock("locked"), github(TrustTier.VERIFIED), AFTER, COMPUTED_AT);
  assert.equal(notHolding.tier, TrustTier.LOCKED);
});

test("missing github evidence defaults holding tier to LOCKED", () => {
  const result = projectTrust(lock("locked"), null, BEFORE, COMPUTED_AT);
  assert.equal(result.tier, TrustTier.LOCKED);
  assert.equal(result.isExpired, false);
});

test("isLockHoldingTier is true only for locked", () => {
  assert.equal(isLockHoldingTier("locked"), true);
  assert.equal(isLockHoldingTier("unlock_eligible"), false);
  assert.equal(isLockHoldingTier("withdrawn"), false);
  assert.equal(isLockHoldingTier("anomalous"), false);
});

test("deriveLockStatus applies wall-clock eligibility and preserves proven states", () => {
  assert.equal(deriveLockStatus("locked", CLIFF, BEFORE), "locked");
  assert.equal(deriveLockStatus("locked", CLIFF, AFTER), "unlock_eligible");
  assert.equal(deriveLockStatus("unlock_eligible", CLIFF, BEFORE), "unlock_eligible");
  assert.equal(deriveLockStatus("withdrawn", CLIFF, AFTER), "withdrawn");
  assert.equal(deriveLockStatus("anomalous", CLIFF, BEFORE), "anomalous");
});

test("deriveLockStatus with invalid cliff is anomalous", () => {
  assert.equal(deriveLockStatus("locked", "not-a-date", AFTER), "anomalous");
});

test("unlockEligibleAt returns cliff unless withdrawn or anomalous", () => {
  assert.equal(unlockEligibleAt("locked", CLIFF), CLIFF);
  assert.equal(unlockEligibleAt("unlock_eligible", CLIFF), CLIFF);
  assert.equal(unlockEligibleAt("withdrawn", CLIFF), null);
  assert.equal(unlockEligibleAt("anomalous", CLIFF), null);
});

test("lockEvidenceFromRow maps canonical columns", () => {
  const evidence = lockEvidenceFromRow({
    id: "lock-1",
    token_id: "tok-1",
    mint: "mint-1",
    stream_program: "prog",
    stream_id: "stream-1",
    deposited_amount: "100",
    withdrawn_amount: "0",
    total_supply_raw: null,
    decimals: null,
    lock_bps: null,
    cliff_ts: CLIFF,
    status: "locked",
    canonical: true,
    last_verified_at: "2026-06-01T00:00:00.000Z",
  });
  assert.deepEqual(evidence, {
    status: "locked",
    cliffTs: CLIFF,
    lastVerifiedAt: "2026-06-01T00:00:00.000Z",
  });
});
