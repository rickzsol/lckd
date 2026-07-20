import assert from "node:assert/strict";
import test from "node:test";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { ParsedAccountData } from "@solana/web3.js";
import { parseMarketEvidence, parseMintEvidence, summarizeConcentration } from "./evidence.server";
import { formatTokenQuote } from "./format";

function mintData(info: Record<string, unknown>): ParsedAccountData {
  return { parsed: { info, type: "mint" }, program: "spl-token", space: 82 };
}

test("mint evidence marks revoked legacy authorities as observed", () => {
  const result = parseMintEvidence(mintData({
    decimals: 6,
    freezeAuthority: null,
    isInitialized: true,
    mintAuthority: null,
    supply: "1000000",
  }), TOKEN_PROGRAM_ID);

  assert.equal(result.program, "SPL Token");
  assert.equal(result.decimals, 6);
  assert.equal(result.authorities.status, "verified");
  assert.equal(result.extensions.status, "verified");
});

test("mint evidence flags active authority and controlling Token-2022 extensions", () => {
  const result = parseMintEvidence(mintData({
    decimals: 9,
    extensions: [
      { extension: "metadataPointer" },
      { extension: "transferFeeConfig" },
      { extension: "permanentDelegate" },
      { extension: "pausableConfig" },
      { extension: "scaledUiAmountConfig" },
    ],
    freezeAuthority: "Freeze11111111111111111111111111111111111",
    mintAuthority: null,
    supply: "1000000000",
  }), TOKEN_2022_PROGRAM_ID);

  assert.equal(result.program, "Token-2022");
  assert.equal(result.authorities.status, "caution");
  assert.deepEqual(result.extensions.flagged, [
    "transferFeeConfig",
    "permanentDelegate",
    "pausableConfig",
    "scaledUiAmountConfig",
  ]);
  assert.equal(result.extensions.status, "caution");
});

test("market evidence selects the deepest Solana pair and applies the review floor", () => {
  const result = parseMarketEvidence([
    { chainId: "ethereum", liquidity: { usd: 1_000_000 } },
    { chainId: "solana", dexId: "orca", liquidity: { usd: 12_000 }, pairAddress: "shallow" },
    { chainId: "solana", dexId: "raydium", liquidity: { usd: 24_999 }, pairAddress: "deep" },
  ], new Date("2026-07-20T12:00:00.000Z"));

  assert.equal(result.pairAddress, "deep");
  assert.equal(result.liquidityUsd, 24_999);
  assert.equal(result.status, "caution");
  assert.equal(result.asOf, "2026-07-20T12:00:00.000Z");
});

test("market evidence stays unknown when no Solana pair is available", () => {
  assert.equal(parseMarketEvidence([{ chainId: "ethereum" }]).status, "unknown");
});

test("concentration stays unknown when largest-account coverage is incomplete", () => {
  const result = summarizeConcentration([BigInt(40), BigInt(20)], BigInt(100), 3, 2);
  assert.equal(result.status, "unknown");
  assert.equal(result.topTenOwnerPercent, null);
  assert.equal(result.accountsRequested, 3);
});

test("concentration reports a lower bound only with complete account coverage", () => {
  const result = summarizeConcentration([BigInt(40), BigInt(20)], BigInt(100), 2, 2);
  assert.equal(result.status, "caution");
  assert.equal(result.topTenOwnerPercent, 60);
});

test("quote formatter preserves positive sub-cent outputs", () => {
  assert.equal(formatTokenQuote("1", 6), "<0.01");
  assert.equal(formatTokenQuote("9999", 6), "<0.01");
});

test("quote formatter compacts ordinary token outputs and fails closed", () => {
  assert.equal(formatTokenQuote("191719181806", 6), "191.72K");
  assert.equal(formatTokenQuote("0", 6), "0");
  assert.equal(formatTokenQuote("10", null), "Unknown");
  assert.equal(formatTokenQuote("1.2", 6), "Unknown");
});
