import assert from "node:assert/strict";
import test from "node:test";
import { TRUST_POLICY_VERSION } from "@/lib/trust/projection";
import { envelope } from "./envelope";

test("wraps data with provenance and policy version", () => {
  const asOf = "2026-07-17T19:00:00.000Z";
  const result = envelope({ value: 42 }, { source: "https://lckd.tech/unlocks", asOf });
  assert.deepEqual(result, {
    asOf,
    source: "https://lckd.tech/unlocks",
    stale: false,
    policyVersion: TRUST_POLICY_VERSION,
    data: { value: 42 },
  });
});

test("policyVersion always equals TRUST_POLICY_VERSION", () => {
  const result = envelope(null, { source: "https://lckd.tech/token/mint" });
  assert.equal(result.policyVersion, TRUST_POLICY_VERSION);
});

test("asOf defaults to a valid ISO timestamp when omitted", () => {
  const result = envelope([], { source: "https://lckd.tech/unlocks" });
  assert.equal(typeof result.asOf, "string");
  assert(Number.isFinite(new Date(result.asOf).getTime()));
});

test("stale defaults to false and can be overridden", () => {
  const fresh = envelope({}, { source: "https://lckd.tech/unlocks" });
  assert.equal(fresh.stale, false);
  const stale = envelope({}, { source: "https://lckd.tech/unlocks", stale: true });
  assert.equal(stale.stale, true);
});
