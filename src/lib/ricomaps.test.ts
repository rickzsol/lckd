import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchHolderIntel, riskLevelColor, truncateAddress } from "./ricomaps";

test("truncateAddress shortens long addresses to first4…last4", () => {
  assert.equal(
    truncateAddress("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"),
    "7xKX…gAsU",
  );
});

test("truncateAddress leaves short strings unchanged", () => {
  assert.equal(truncateAddress("abc123"), "abc123");
});

test("riskLevelColor maps green/yellow/red to the design system tokens", () => {
  assert.equal(riskLevelColor("green").text, "text-accent-400");
  assert.equal(riskLevelColor("yellow").text, "text-warn");
  assert.equal(riskLevelColor("red").text, "text-danger");
});

test("fetchHolderIntel returns unavailable for a malformed mint (no URL construction)", async () => {
  const result = await fetchHolderIntel("not-a-real-mint");
  assert.equal(result.status, "unavailable");
  assert.equal(result.data, null);
});

test("fetchHolderIntel returns unavailable when env is not configured", async () => {
  const previousUrl = process.env.RICOMAPS_API_URL;
  const previousKey = process.env.RICOMAPS_API_KEY;
  const previousFixtures = process.env.RICOMAPS_FIXTURES;
  Reflect.deleteProperty(process.env, "RICOMAPS_API_URL");
  Reflect.deleteProperty(process.env, "RICOMAPS_API_KEY");
  Reflect.deleteProperty(process.env, "RICOMAPS_FIXTURES");
  try {
    const result = await fetchHolderIntel("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    assert.equal(result.status, "unavailable");
  } finally {
    if (previousUrl !== undefined) Reflect.set(process.env, "RICOMAPS_API_URL", previousUrl);
    if (previousKey !== undefined) Reflect.set(process.env, "RICOMAPS_API_KEY", previousKey);
    if (previousFixtures !== undefined) {
      Reflect.set(process.env, "RICOMAPS_FIXTURES", previousFixtures);
    }
  }
});

test("fetchHolderIntel fixture mode returns fresh data with expected shape", async () => {
  const previousFixtures = process.env.RICOMAPS_FIXTURES;
  Reflect.set(process.env, "RICOMAPS_FIXTURES", "1");
  try {
    const result = await fetchHolderIntel("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    assert.equal(result.status, "fresh");
    assert.ok(result.data);
    assert.equal(result.data?.riskLevel, "green");
    assert.equal(result.data?.topHolders.length, 20);
  } finally {
    if (previousFixtures === undefined) {
      Reflect.deleteProperty(process.env, "RICOMAPS_FIXTURES");
    } else {
      Reflect.set(process.env, "RICOMAPS_FIXTURES", previousFixtures);
    }
  }
});

test("fetchHolderIntel fixture mode returns pending status for pending-suffixed mint", async () => {
  const previousFixtures = process.env.RICOMAPS_FIXTURES;
  Reflect.set(process.env, "RICOMAPS_FIXTURES", "1");
  try {
    const result = await fetchHolderIntel("FixtureMintEndingInpending");
    assert.equal(result.status, "pending");
    assert.equal(result.data, null);
  } finally {
    if (previousFixtures === undefined) {
      Reflect.deleteProperty(process.env, "RICOMAPS_FIXTURES");
    } else {
      Reflect.set(process.env, "RICOMAPS_FIXTURES", previousFixtures);
    }
  }
});
