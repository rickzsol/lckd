import "server-only";

import { Connection, PublicKey } from "@solana/web3.js";
import {
  BUYBACK_BURN_LAMPORTS,
  BUYBACK_BURN_PROGRAM_ID,
  deriveBuybackBurnAuthority,
} from "@/lib/solana/buybackBurn";
import { buildBuybackBurnInstruction } from "@/lib/solana/buybackBurn.server";
import {
  assertLaunchFeeTerms,
  WAIVED_FEE_TERMS,
  type LaunchFeeTerms,
} from "@/lib/solana/launchFee";

const MAX_QUOTE_AGE_MS = 5 * 60 * 1_000;

export class LaunchFeeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function readFeeLamports(): number {
  const feeLamports = Number(process.env.LAUNCH_FEE_LAMPORTS ?? "0");
  if (
    !Number.isSafeInteger(feeLamports) ||
    (feeLamports !== 0 && feeLamports !== BUYBACK_BURN_LAMPORTS)
  ) {
    throw new LaunchFeeError(
      `Launch fee must be disabled or exactly ${BUYBACK_BURN_LAMPORTS} lamports`,
      503,
    );
  }
  return feeLamports;
}

function getFeeConnection(): Connection {
  const rpcUrl = process.env.HELIUS_RPC_URL ?? process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
  if (!rpcUrl) throw new LaunchFeeError("Launch fee resolution is unavailable", 503);
  return new Connection(rpcUrl, "confirmed");
}

export interface ResolvedLaunchFee extends LaunchFeeTerms {
  quotedAt: string;
}

export async function resolveLaunchFeeTerms(
  wallet: PublicKey,
  _preference: "burnLckd" | "sol" | undefined,
  now: Date = new Date(),
): Promise<ResolvedLaunchFee> {
  const feeLamports = readFeeLamports();
  if (feeLamports === 0) {
    return { ...WAIVED_FEE_TERMS, quotedAt: now.toISOString() };
  }

  try {
    const authority = deriveBuybackBurnAuthority(BUYBACK_BURN_PROGRAM_ID);
    const { snapshot } = await buildBuybackBurnInstruction({
      connection: getFeeConnection(),
      programId: BUYBACK_BURN_PROGRAM_ID,
      launcher: wallet,
      authority,
    });
    const terms: LaunchFeeTerms = {
      feeMode: "buybackBurn",
      feeLamports,
      feeLckdRaw: snapshot.minimumBaseAmountOut,
      feeTreasury: authority.toBase58(),
    };
    assertLaunchFeeTerms(terms);
    return { ...terms, quotedAt: now.toISOString() };
  } catch (error) {
    if (error instanceof LaunchFeeError) throw error;
    console.error("[launch/fee] Buyback quote failed:", error);
    throw new LaunchFeeError("LCKD buyback quote is unavailable", 503);
  }
}

export function isQuoteFresh(quotedAt: string, now: Date = new Date()): boolean {
  const quoted = new Date(quotedAt).getTime();
  return Number.isFinite(quoted) && now.getTime() - quoted <= MAX_QUOTE_AGE_MS;
}
