import assert from "node:assert/strict";
import test from "node:test";
import { pctOfSupply } from "./response";

test("pctOfSupply returns null when the denominator is missing", () => {
  assert.equal(pctOfSupply("100", null), null);
});

test("pctOfSupply returns null for a zero or invalid denominator", () => {
  assert.equal(pctOfSupply("100", "0"), null);
  assert.equal(pctOfSupply("100", "not-a-number"), null);
  assert.equal(pctOfSupply("nope", "100"), null);
});

test("pctOfSupply computes a plain percentage", () => {
  assert.equal(pctOfSupply("250", "1000"), 25);
  assert.equal(pctOfSupply("1", "1000"), 0.1);
});

test("pctOfSupply keeps full precision on u64-scale values that overflow a JS number", () => {
  // 10% of a supply far beyond Number.MAX_SAFE_INTEGER. Number(deposited) would
  // corrupt the numerator; BigInt math keeps it exact (finding 9).
  const supply = "18446744073709551610"; // ~2^64
  const deposited = "1844674407370955161"; // 10%
  const pct = pctOfSupply(deposited, supply);
  assert.ok(pct !== null);
  assert.ok(Math.abs(pct - 10) < 0.001, `expected ~10, got ${pct}`);
});

test("pctOfSupply does not lose the whole locked amount to number narrowing", () => {
  // deposited exceeds MAX_SAFE_INTEGER; a naive Number() would round it.
  const deposited = "9007199254740993"; // MAX_SAFE_INTEGER + 2
  const supply = "9007199254740993";
  assert.equal(pctOfSupply(deposited, supply), 100);
});
