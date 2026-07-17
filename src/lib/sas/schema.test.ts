import assert from "node:assert/strict";
import test from "node:test";

import {
  BPS_DENOMINATOR,
  SCHEMA_FIELDS,
  SCHEMA_LAYOUT,
  TRUST_TIER,
  deserializeTrustData,
  serializeTrustData,
  type TrustAttestationData,
} from "./schema";

const SAMPLE: TrustAttestationData = {
  mint: "So11111111111111111111111111111111111111112",
  creator: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  stream_id: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  tier: TRUST_TIER.BUILDER,
  lock_bps: 6543,
  cliff_ts: BigInt(1893456000),
  policy_version: 1,
  github: "octocat",
};

test("layout and field names stay positionally aligned", () => {
  assert.equal(SCHEMA_LAYOUT.length, SCHEMA_FIELDS.length);
  // mint/creator/stream_id/github are strings (12), tier/policy u8 (0),
  // lock_bps u16 (1), cliff_ts u64 (3).
  assert.deepEqual(Array.from(SCHEMA_LAYOUT), [12, 12, 12, 0, 1, 3, 0, 12]);
});

test("serialize/deserialize round-trips every field", () => {
  const bytes = serializeTrustData(SAMPLE);
  const back = deserializeTrustData(bytes);
  assert.equal(back.mint, SAMPLE.mint);
  assert.equal(back.creator, SAMPLE.creator);
  assert.equal(back.stream_id, SAMPLE.stream_id);
  assert.equal(back.tier, SAMPLE.tier);
  assert.equal(back.lock_bps, SAMPLE.lock_bps);
  assert.equal(back.cliff_ts, SAMPLE.cliff_ts);
  assert.equal(back.policy_version, SAMPLE.policy_version);
  assert.equal(back.github, SAMPLE.github);
});

test("round-trip preserves an empty github handle", () => {
  const bytes = serializeTrustData({ ...SAMPLE, github: "" });
  assert.equal(deserializeTrustData(bytes).github, "");
});

test("serialization is deterministic", () => {
  const a = serializeTrustData(SAMPLE);
  const b = serializeTrustData(SAMPLE);
  assert.deepEqual(Array.from(a), Array.from(b));
});

test("rejects out-of-range tier", () => {
  assert.throws(() => serializeTrustData({ ...SAMPLE, tier: 5 }));
  assert.throws(() => serializeTrustData({ ...SAMPLE, tier: 0 }));
});

test("rejects lock_bps above the denominator", () => {
  assert.throws(() => serializeTrustData({ ...SAMPLE, lock_bps: BPS_DENOMINATOR + 1 }));
});

test("rejects a non-positive cliff", () => {
  assert.throws(() => serializeTrustData({ ...SAMPLE, cliff_ts: BigInt(0) }));
});
