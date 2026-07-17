import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchHolderIntel, riskLevelColor, truncateAddress } from "./ricomaps";
import { FIXTURE_MINTS } from "./ricomaps.fixtures";

function withEnv(overrides: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else Reflect.set(process.env, key, value);
  }

  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else Reflect.set(process.env, key, value);
    }
  });
}

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

test("fetchHolderIntel returns unavailable when env is not configured", () =>
  withEnv(
    { RICOMAPS_API_URL: undefined, RICOMAPS_API_KEY: undefined, RICOMAPS_FIXTURES: undefined },
    async () => {
      const result = await fetchHolderIntel("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
      assert.equal(result.status, "unavailable");
    },
  ));

test("fetchHolderIntel fixture mode is ignored in production even when enabled", () =>
  withEnv({ NODE_ENV: "production", RICOMAPS_FIXTURES: "1" }, async () => {
    const result = await fetchHolderIntel(FIXTURE_MINTS.green);
    assert.equal(result.status, "unavailable");
  }));

test("fetchHolderIntel fixture mode returns fresh data for the green fixture mint", () =>
  withEnv({ RICOMAPS_FIXTURES: "1" }, async () => {
    const result = await fetchHolderIntel(FIXTURE_MINTS.green);
    assert.equal(result.status, "fresh");
    assert.ok(result.data);
    assert.equal(result.data?.riskLevel, "green");
    assert.equal(result.data?.topHolders.length, 20);
  }));

test("fetchHolderIntel fixture mode returns pending status for the pending fixture mint", () =>
  withEnv({ RICOMAPS_FIXTURES: "1" }, async () => {
    const result = await fetchHolderIntel(FIXTURE_MINTS.pending);
    assert.equal(result.status, "pending");
    assert.equal(result.data, null);
    assert.ok(typeof result.retryAfterSeconds === "number");
  }));

test("fetchHolderIntel fixture mode returns unavailable for the unavailable fixture mint", () =>
  withEnv({ RICOMAPS_FIXTURES: "1" }, async () => {
    const result = await fetchHolderIntel(FIXTURE_MINTS.unavailable);
    assert.equal(result.status, "unavailable");
    assert.equal(result.data, null);
  }));

test("fetchHolderIntel fixture mode still validates the mint before returning a fixture", () =>
  withEnv({ RICOMAPS_FIXTURES: "1" }, async () => {
    const result = await fetchHolderIntel("not-a-real-mint");
    assert.equal(result.status, "unavailable");
  }));
