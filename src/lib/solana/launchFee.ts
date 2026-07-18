import {
  createBurnInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

export const LCKD_MINT_ADDRESS = "7UTubJ3W6JWwLUj82B9LgHFDmc8wFWtSNLis6u8epump";
export const LCKD_DECIMALS = 6;

export type LaunchFeeMode = "waived" | "burnLckd" | "sol" | "buybackBurn";

export interface LaunchFeeTerms {
  feeMode: LaunchFeeMode;
  /** Lamports transferred to the treasury; required when feeMode is "sol". */
  feeLamports: number | null;
  /** Raw LCKD base units burned; required when feeMode is "burnLckd". */
  feeLckdRaw: string | null;
  /** Treasury wallet receiving the SOL fee; required when feeMode is "sol". */
  feeTreasury: string | null;
}

export const WAIVED_FEE_TERMS: LaunchFeeTerms = Object.freeze({
  feeMode: "waived",
  feeLamports: null,
  feeLckdRaw: null,
  feeTreasury: null,
});

const MAX_FEE_LAMPORTS = 10_000_000_000;
const MAX_FEE_LCKD_RAW = BigInt("1000000000000000");

export function assertLaunchFeeTerms(terms: LaunchFeeTerms): void {
  if (terms.feeMode === "waived") {
    if (terms.feeLamports !== null || terms.feeLckdRaw !== null || terms.feeTreasury !== null) {
      throw new Error("Waived launch fee terms must not carry amounts");
    }
    return;
  }
  if (terms.feeMode === "burnLckd") {
    if (
      terms.feeLamports !== null || terms.feeTreasury !== null ||
      typeof terms.feeLckdRaw !== "string" || !/^\d+$/.test(terms.feeLckdRaw) ||
      BigInt(terms.feeLckdRaw) < BigInt(1) || BigInt(terms.feeLckdRaw) > MAX_FEE_LCKD_RAW
    ) {
      throw new Error("LCKD burn fee terms are invalid");
    }
    return;
  }
  if (terms.feeMode === "buybackBurn") {
    if (
      terms.feeLamports !== 100_000_000 || typeof terms.feeTreasury !== "string" ||
      typeof terms.feeLckdRaw !== "string" || !/^\d+$/.test(terms.feeLckdRaw) ||
      BigInt(terms.feeLckdRaw) < BigInt(1) || BigInt(terms.feeLckdRaw) > MAX_FEE_LCKD_RAW
    ) {
      throw new Error("Buyback-and-burn launch fee terms are invalid");
    }
    new PublicKey(terms.feeTreasury);
    return;
  }
  if (terms.feeMode === "sol") {
    if (
      terms.feeLckdRaw !== null || typeof terms.feeTreasury !== "string" ||
      !Number.isSafeInteger(terms.feeLamports) || (terms.feeLamports ?? 0) < 1 ||
      (terms.feeLamports ?? 0) > MAX_FEE_LAMPORTS
    ) {
      throw new Error("SOL launch fee terms are invalid");
    }
    new PublicKey(terms.feeTreasury);
    return;
  }
  throw new Error("Launch fee mode is invalid");
}

export function launchFeeTermsFromConfig(config: Record<string, unknown>): LaunchFeeTerms {
  // Configs persisted before fee support carry no fee fields and stay free.
  if (config.feeMode === undefined) return WAIVED_FEE_TERMS;
  const terms: LaunchFeeTerms = {
    feeMode: config.feeMode as LaunchFeeMode,
    feeLamports: (config.feeLamports ?? null) as number | null,
    feeLckdRaw: (config.feeLckdRaw ?? null) as string | null,
    feeTreasury: (config.feeTreasury ?? null) as string | null,
  };
  assertLaunchFeeTerms(terms);
  return terms;
}

export function buildLaunchFeeInstruction(
  wallet: PublicKey,
  terms: LaunchFeeTerms,
): TransactionInstruction | null {
  assertLaunchFeeTerms(terms);
  if (terms.feeMode === "waived") return null;
  if (terms.feeMode === "burnLckd") {
    const lckdMint = new PublicKey(LCKD_MINT_ADDRESS);
    return createBurnInstruction(
      getAssociatedTokenAddressSync(lckdMint, wallet, false, TOKEN_PROGRAM_ID),
      lckdMint,
      wallet,
      BigInt(terms.feeLckdRaw!),
    );
  }
  if (terms.feeMode === "buybackBurn") {
    throw new Error("Buyback-and-burn fees require the atomic launch builder");
  }
  return SystemProgram.transfer({
    fromPubkey: wallet,
    toPubkey: new PublicKey(terms.feeTreasury!),
    lamports: terms.feeLamports!,
  });
}

export function formatLaunchFee(terms: LaunchFeeTerms): string {
  if (terms.feeMode === "waived") return "waived";
  if (terms.feeMode === "burnLckd") {
    const tokens = Number(BigInt(terms.feeLckdRaw!)) / 10 ** LCKD_DECIMALS;
    return `burn ${tokens.toLocaleString("en-US", { maximumFractionDigits: 2 })} LCKD`;
  }
  if (terms.feeMode === "buybackBurn") {
    return "0.1 SOL LCKD buyback and burn";
  }
  return `${((terms.feeLamports ?? 0) / 1_000_000_000).toLocaleString("en-US", {
    maximumFractionDigits: 4,
  })} SOL`;
}
