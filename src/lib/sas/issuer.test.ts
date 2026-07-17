import assert from "node:assert/strict";
import test from "node:test";

import { decideIssuance, type DesiredPayload } from "./issuer";

const DESIRED: DesiredPayload = {
  tier: 3,
  lockBps: 6500,
  cliffTs: BigInt(1893456000),
  policyVersion: 1,
};

test("no live attestation issues fresh", () => {
  assert.equal(decideIssuance(null, DESIRED), "issue");
});

test("identical live payload skips", () => {
  assert.equal(decideIssuance({ ...DESIRED }, DESIRED), "skip");
});

test("tier change reissues", () => {
  assert.equal(decideIssuance({ ...DESIRED, tier: 2 }, DESIRED), "reissue");
});

test("lock_bps change reissues", () => {
  assert.equal(decideIssuance({ ...DESIRED, lockBps: 6499 }, DESIRED), "reissue");
});

test("cliff change reissues", () => {
  assert.equal(decideIssuance({ ...DESIRED, cliffTs: BigInt(1) }, DESIRED), "reissue");
});

test("policy version change reissues", () => {
  assert.equal(decideIssuance({ ...DESIRED, policyVersion: 2 }, DESIRED), "reissue");
});
