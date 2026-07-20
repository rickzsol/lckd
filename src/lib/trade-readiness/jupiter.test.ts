import assert from "node:assert/strict";
import test from "node:test";
import { normalizedImpactPercent, parseJupiterOrder } from "./jupiter.server";

test("Jupiter parser prefers the decimal price impact field", () => {
  const order = parseJupiterOrder({
    inAmount: "100000000",
    inUsdValue: 10,
    outAmount: "200000000000",
    outUsdValue: 9.7,
    priceImpact: -3,
    priceImpactPct: "-0.03",
    router: "metis",
  });

  assert.equal(normalizedImpactPercent(order), 3);
});

test("Jupiter parser derives impact from USD values when the decimal field is absent", () => {
  const order = parseJupiterOrder({
    inAmount: "100000000",
    inUsdValue: 8,
    outAmount: "200000000000",
    outUsdValue: 7.6,
    priceImpact: -5,
    router: "dflow",
  });

  assert.ok(Math.abs((normalizedImpactPercent(order) ?? 0) - 5) < 0.000001);
});

test("Jupiter parser rejects non-integer amounts", () => {
  assert.throws(() => parseJupiterOrder({
    inAmount: "0.1",
    outAmount: "20",
    router: "metis",
  }), /invalid/);
});
