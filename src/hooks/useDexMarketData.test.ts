import assert from "node:assert/strict";
import test from "node:test";
import { parseDexMarketPairs } from "./useDexMarketData";

test("uses the deepest Solana market and formats live values", () => {
  assert.deepEqual(parseDexMarketPairs([
    {
      chainId: "solana",
      liquidity: { usd: 500 },
      priceUsd: "0.0001",
    },
    {
      chainId: "solana",
      liquidity: { usd: 125000 },
      marketCap: 2500000,
      priceChange: { h24: 12.345 },
      priceUsd: "0.0042",
      volume: { h24: 84000 },
    },
  ]), {
    change24h: "+12.35%",
    liquidity: "$125.00K",
    marketCap: "$2.50M",
    price: "$0.004200",
    volume24h: "$84.00K",
  });
});

test("rejects empty and non-Solana market responses", () => {
  assert.equal(parseDexMarketPairs(null), null);
  assert.equal(parseDexMarketPairs([{ chainId: "ethereum" }]), null);
});
