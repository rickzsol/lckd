import "server-only";

import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { isValidSolanaAddress } from "./validation";
import {
  assertLaunchFeeTerms,
  LCKD_DECIMALS,
  LCKD_MINT_ADDRESS,
  WAIVED_FEE_TERMS,
  type LaunchFeeTerms,
} from "@/lib/solana/launchFee";

const DEFAULT_BURN_DISCOUNT_BPS = 2_000;
const MAX_QUOTE_AGE_MS = 5 * 60 * 1_000;

export class LaunchFeeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

interface FeeEnvironment {
  feeLamports: number;
  waiverThresholdRaw: bigint;
  treasury: string | null;
  burnDiscountBps: number;
}

function readFeeEnvironment(): FeeEnvironment {
  const feeLamports = Number(process.env.LAUNCH_FEE_LAMPORTS ?? "0");
  const waiver = process.env.LAUNCH_FEE_WAIVER_LCKD_RAW ?? "250000000000";
  const discount = Number(process.env.LAUNCH_FEE_BURN_DISCOUNT_BPS ?? `${DEFAULT_BURN_DISCOUNT_BPS}`);
  const treasury = process.env.LAUNCH_FEE_TREASURY?.trim() || null;
  if (!Number.isSafeInteger(feeLamports) || feeLamports < 0) {
    throw new LaunchFeeError("Launch fee configuration is invalid", 503);
  }
  if (treasury && !isValidSolanaAddress(treasury)) {
    throw new LaunchFeeError("Launch fee treasury is invalid", 503);
  }
  if (!/^\d+$/.test(waiver) || !Number.isInteger(discount) || discount < 0 || discount > 9_000) {
    throw new LaunchFeeError("Launch fee configuration is invalid", 503);
  }
  return {
    feeLamports,
    waiverThresholdRaw: BigInt(waiver),
    treasury,
    burnDiscountBps: discount,
  };
}

async function fetchWalletLckdRaw(connection: Connection, wallet: PublicKey): Promise<bigint> {
  try {
    const ata = getAssociatedTokenAddressSync(
      new PublicKey(LCKD_MINT_ADDRESS),
      wallet,
      false,
      TOKEN_PROGRAM_ID,
    );
    const balance = await connection.getTokenAccountBalance(ata, "confirmed");
    return BigInt(balance.value.amount);
  } catch {
    return BigInt(0);
  }
}

interface DexScreenerPair {
  priceNative?: string;
  liquidity?: { usd?: number };
  baseToken?: { address?: string };
}

async function fetchLckdLamportsPerToken(): Promise<number> {
  const response = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${LCKD_MINT_ADDRESS}`,
    { next: { revalidate: 60 } },
  ).catch(() => null);
  if (!response?.ok) throw new LaunchFeeError("LCKD price is unavailable for fee pricing", 503);
  const json = (await response.json()) as { pairs?: DexScreenerPair[] };
  const pair = (json.pairs ?? [])
    .filter((candidate) => candidate.baseToken?.address === LCKD_MINT_ADDRESS)
    .reduce<DexScreenerPair | null>(
      (best, candidate) =>
        (candidate.liquidity?.usd ?? 0) > (best?.liquidity?.usd ?? 0) ? candidate : best,
      null,
    );
  const priceNative = parseFloat(pair?.priceNative ?? "");
  if (!Number.isFinite(priceNative) || priceNative <= 0) {
    throw new LaunchFeeError("LCKD price is unavailable for fee pricing", 503);
  }
  return priceNative * 1_000_000_000;
}

export interface ResolvedLaunchFee extends LaunchFeeTerms {
  quotedAt: string;
}

function getFeeConnection(): Connection {
  const rpcUrl = process.env.HELIUS_RPC_URL ?? process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
  if (!rpcUrl) throw new LaunchFeeError("Launch fee resolution is unavailable", 503);
  return new Connection(rpcUrl, "confirmed");
}

export async function resolveLaunchFeeTerms(
  wallet: PublicKey,
  preference: "burnLckd" | "sol" | undefined,
  now: Date = new Date(),
): Promise<ResolvedLaunchFee> {
  const environment = readFeeEnvironment();
  if (environment.feeLamports === 0) {
    return { ...WAIVED_FEE_TERMS, quotedAt: now.toISOString() };
  }
  const heldRaw = await fetchWalletLckdRaw(getFeeConnection(), wallet);
  if (environment.waiverThresholdRaw > BigInt(0) && heldRaw >= environment.waiverThresholdRaw) {
    return { ...WAIVED_FEE_TERMS, quotedAt: now.toISOString() };
  }

  const wantsSol = preference === "sol";
  if (wantsSol) {
    if (!environment.treasury) {
      throw new LaunchFeeError("SOL launch fees are not accepting payments yet", 503);
    }
    const terms: LaunchFeeTerms = {
      feeMode: "sol",
      feeLamports: environment.feeLamports,
      feeLckdRaw: null,
      feeTreasury: environment.treasury,
    };
    assertLaunchFeeTerms(terms);
    return { ...terms, quotedAt: now.toISOString() };
  }

  const lamportsPerToken = await fetchLckdLamportsPerToken();
  const discountedLamports =
    (environment.feeLamports * (10_000 - environment.burnDiscountBps)) / 10_000;
  const rawAmount = BigInt(
    Math.max(1, Math.ceil((discountedLamports / lamportsPerToken) * 10 ** LCKD_DECIMALS)),
  );
  if (heldRaw < rawAmount) {
    if (environment.treasury) {
      const fallback: LaunchFeeTerms = {
        feeMode: "sol",
        feeLamports: environment.feeLamports,
        feeLckdRaw: null,
        feeTreasury: environment.treasury,
      };
      assertLaunchFeeTerms(fallback);
      return { ...fallback, quotedAt: now.toISOString() };
    }
    throw new LaunchFeeError(
      `Launching requires burning ${Number(rawAmount) / 10 ** LCKD_DECIMALS} LCKD; the connected wallet holds less`,
      422,
    );
  }
  const terms: LaunchFeeTerms = {
    feeMode: "burnLckd",
    feeLamports: null,
    feeLckdRaw: rawAmount.toString(),
    feeTreasury: null,
  };
  assertLaunchFeeTerms(terms);
  return { ...terms, quotedAt: now.toISOString() };
}

export function isQuoteFresh(quotedAt: string, now: Date = new Date()): boolean {
  const quoted = new Date(quotedAt).getTime();
  return Number.isFinite(quoted) && now.getTime() - quoted <= MAX_QUOTE_AGE_MS;
}
