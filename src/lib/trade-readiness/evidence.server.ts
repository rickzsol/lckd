import "server-only";

import {
  Connection,
  type ParsedAccountData,
  PublicKey,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type {
  EvidenceStatus,
  MarketEvidence,
  OnchainEvidence,
  TradeReadinessEvidence,
} from "./types";

const CAUTION_EXTENSIONS = new Set([
  "confidentialTransferMint",
  "defaultAccountState",
  "nonTransferable",
  "pausableConfig",
  "permanentDelegate",
  "scaledUiAmountConfig",
  "transferFeeConfig",
  "transferHook",
]);

function unknownOnchainEvidence(): OnchainEvidence {
  return {
    asOf: null,
    authorities: { freezeAuthority: null, mintAuthority: null, status: "unknown" },
    concentration: { accountsRequested: null, ownersAnalyzed: null, status: "unknown", topTenOwnerPercent: null },
    decimals: null,
    extensions: { names: [], flagged: [], status: "unknown" },
    program: "Unknown",
    slot: null,
  };
}

function unknownMarketEvidence(): MarketEvidence {
  return {
    asOf: null,
    dex: null,
    liquidityUsd: null,
    pairAddress: null,
    pairCreatedAt: null,
    status: "unknown",
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function optionalAddress(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseMintEvidence(
  data: ParsedAccountData,
  owner: PublicKey,
): Pick<OnchainEvidence, "authorities" | "decimals" | "extensions" | "program"> & { supply: bigint } {
  const info = record(data.parsed)?.info;
  const parsedInfo = record(info);
  if (!parsedInfo) throw new Error("Mint account data is unavailable");

  const mintAuthority = optionalAddress(parsedInfo.mintAuthority);
  const freezeAuthority = optionalAddress(parsedInfo.freezeAuthority);
  const rawSupply = parsedInfo.supply;
  const decimals = parsedInfo.decimals;
  if (typeof rawSupply !== "string" || !/^\d+$/.test(rawSupply)) {
    throw new Error("Mint supply is unavailable");
  }
  if (!Number.isInteger(decimals) || Number(decimals) < 0) {
    throw new Error("Mint decimals are unavailable");
  }

  const extensions = Array.isArray(parsedInfo.extensions)
    ? parsedInfo.extensions.flatMap((extension) => {
        const name = record(extension)?.extension;
        return typeof name === "string" ? [name] : [];
      })
    : [];
  const flagged = extensions.filter((name) => CAUTION_EXTENSIONS.has(name));

  return {
    authorities: {
      freezeAuthority,
      mintAuthority,
      status: mintAuthority || freezeAuthority ? "caution" : "verified",
    },
    decimals: Number(decimals),
    extensions: {
      names: extensions,
      flagged,
      status: flagged.length > 0 ? "caution" : "verified",
    },
    program: owner.equals(TOKEN_2022_PROGRAM_ID)
      ? "Token-2022"
      : owner.equals(TOKEN_PROGRAM_ID) ? "SPL Token" : "Unknown",
    supply: BigInt(rawSupply),
  };
}

function concentrationStatus(percent: number): EvidenceStatus {
  return percent >= 50 ? "caution" : "verified";
}

export function summarizeConcentration(
  ownerBalances: readonly bigint[],
  supply: bigint,
  accountsRequested: number,
  accountsResolved: number,
): OnchainEvidence["concentration"] {
  const ownersAnalyzed = ownerBalances.length;
  if (
    supply <= BigInt(0) || accountsRequested === 0 ||
    accountsResolved !== accountsRequested || ownersAnalyzed === 0
  ) {
    return { accountsRequested, ownersAnalyzed, status: "unknown", topTenOwnerPercent: null };
  }
  const topTenBalance = [...ownerBalances]
    .sort((left, right) => left > right ? -1 : left < right ? 1 : 0)
    .slice(0, 10)
    .reduce((total, balance) => total + balance, BigInt(0));
  const topTenOwnerPercent = Number(
    (topTenBalance * BigInt(1_000_000)) / supply,
  ) / 10_000;
  return {
    accountsRequested,
    ownersAnalyzed,
    status: concentrationStatus(topTenOwnerPercent),
    topTenOwnerPercent,
  };
}

async function loadOnchainEvidence(mintAddress: string): Promise<OnchainEvidence> {
  const rpcUrl = process.env.HELIUS_RPC_URL ?? (
    process.env.NODE_ENV === "production" ? undefined : process.env.NEXT_PUBLIC_HELIUS_RPC_URL
  );
  if (!rpcUrl) return unknownOnchainEvidence();

  const mint = new PublicKey(mintAddress);
  const connection = new Connection(rpcUrl, { commitment: "finalized" });
  const [mintResult, largestResult] = await Promise.all([
    connection.getParsedAccountInfo(mint, "finalized"),
    connection.getTokenLargestAccounts(mint, "finalized"),
  ]);
  if (!mintResult.value || Buffer.isBuffer(mintResult.value.data)) {
    throw new Error("Parsed mint account is unavailable");
  }

  const parsedMint = parseMintEvidence(mintResult.value.data, mintResult.value.owner);
  const largest = largestResult.value.slice(0, 20);
  const ownerAccounts = await connection.getMultipleParsedAccounts(
    largest.map(({ address }) => address),
    { commitment: "finalized" },
  );
  const balancesByOwner = new Map<string, bigint>();
  let accountsResolved = 0;
  largest.forEach(({ amount }, index) => {
    const account = ownerAccounts.value[index];
    if (!account || Buffer.isBuffer(account.data)) return;
    const owner = record(record(account.data.parsed)?.info)?.owner;
    if (typeof owner !== "string") return;
    accountsResolved += 1;
    balancesByOwner.set(owner, (balancesByOwner.get(owner) ?? BigInt(0)) + BigInt(amount));
  });

  return {
    asOf: new Date().toISOString(),
    authorities: parsedMint.authorities,
    concentration: summarizeConcentration(
      [...balancesByOwner.values()],
      parsedMint.supply,
      largest.length,
      accountsResolved,
    ),
    decimals: parsedMint.decimals,
    extensions: parsedMint.extensions,
    program: parsedMint.program,
    slot: Math.min(mintResult.context.slot, largestResult.context.slot, ownerAccounts.context.slot),
  };
}

interface DexPair {
  chainId?: string;
  dexId?: string;
  liquidity?: { usd?: number };
  pairAddress?: string;
  pairCreatedAt?: number;
}

export function parseMarketEvidence(value: unknown, asOf = new Date()): MarketEvidence {
  if (!Array.isArray(value)) return unknownMarketEvidence();
  const pairs = value.filter((pair): pair is DexPair => record(pair)?.chainId === "solana");
  if (pairs.length === 0) return unknownMarketEvidence();
  const pair = pairs.reduce((best, candidate) =>
    (candidate.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? candidate : best,
  );
  const liquidityUsd = Number.isFinite(pair.liquidity?.usd) ? Number(pair.liquidity?.usd) : null;
  return {
    asOf: asOf.toISOString(),
    dex: pair.dexId ?? null,
    liquidityUsd,
    pairAddress: pair.pairAddress ?? null,
    pairCreatedAt: Number.isFinite(pair.pairCreatedAt)
      ? new Date(Number(pair.pairCreatedAt)).toISOString()
      : null,
    status: liquidityUsd === null ? "unknown" : liquidityUsd < 25_000 ? "caution" : "verified",
  };
}

async function loadMarketEvidence(mintAddress: string): Promise<MarketEvidence> {
  const response = await fetch(
    `https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(mintAddress)}`,
    { headers: { Accept: "application/json" }, next: { revalidate: 30 }, signal: AbortSignal.timeout(8_000) },
  );
  if (!response.ok) throw new Error(`DexScreener returned ${response.status}`);
  return parseMarketEvidence(await response.json());
}

export async function loadTradeReadinessEvidence(
  mintAddress: string,
): Promise<TradeReadinessEvidence> {
  const [onchain, market] = await Promise.allSettled([
    loadOnchainEvidence(mintAddress),
    loadMarketEvidence(mintAddress),
  ]);
  if (onchain.status === "rejected") console.error("[trade-readiness] On-chain evidence failed");
  if (market.status === "rejected") console.error("[trade-readiness] Market evidence failed");
  return {
    mintAddress,
    onchain: onchain.status === "fulfilled" ? onchain.value : unknownOnchainEvidence(),
    market: market.status === "fulfilled" ? market.value : unknownMarketEvidence(),
  };
}
