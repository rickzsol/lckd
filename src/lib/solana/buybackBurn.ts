import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  canonicalPumpPoolPda,
  GLOBAL_CONFIG_PDA,
  GLOBAL_VOLUME_ACCUMULATOR_PDA,
  PUMP_AMM_EVENT_AUTHORITY_PDA,
  PUMP_AMM_FEE_CONFIG_PDA,
  PUMP_FEE_PROGRAM_ID,
  poolV2Pda,
  PUMP_AMM_PROGRAM_ID,
  userVolumeAccumulatorPda,
} from "@pump-fun/pump-swap-sdk";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import { LCKD_MINT_ADDRESS } from "./launchFee";
import { readU64LE, writeU64LE } from "./u64";

export const BUYBACK_BURN_LAMPORTS = 100_000_000;
export const BUYBACK_BURN_AUTHORITY_SEED = "buyback_burn";
export const BUYBACK_BURN_OUTER_DISCRIMINATOR = 0;
export const BUYBACK_BURN_PROGRAM_ID = new PublicKey(
  "7e37mm6Q8aW13jfZP27mEa1QRjue4fZ6NzNtzJyo8FZV",
);
export const DEFAULT_BUYBACK_SLIPPAGE_BPS = 100;
export const MAX_BUYBACK_SLIPPAGE_BPS = 500;
export const PUMP_PROTOCOL_FEE_RECIPIENT = new PublicKey(
  "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
);
export const PUMP_BUYBACK_FEE_RECIPIENT = new PublicKey(
  "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
);
export const PUMP_CREATOR_VAULT_AUTHORITY = new PublicKey(
  "6YEbcAYNDhf6UXtM8fNXvYL7s58TNF1w21PXHCbm4ite",
);
export const PUMP_BUY_EXACT_QUOTE_IN_ACCOUNT_COUNT = 26;
export const PUMP_BUY_EXACT_QUOTE_IN_DATA_LENGTH = 25;

export const LCKD_MINT = new PublicKey(LCKD_MINT_ADDRESS);
export const LCKD_CANONICAL_PUMP_POOL = canonicalPumpPoolPda(LCKD_MINT, NATIVE_MINT);

const PUMP_BUY_EXACT_QUOTE_IN_DISCRIMINATOR = Buffer.from([
  198, 46, 21, 82, 180, 217, 232, 112,
]);

export interface BuybackBurnQuoteSnapshot {
  version: 1;
  observedSlot: number;
  authority: string;
  pool: string;
  spendableQuoteIn: "100000000";
  expectedBaseAmountOut: string;
  minimumBaseAmountOut: string;
  slippageBps: number;
  poolBaseReserve: string;
  poolQuoteReserve: string;
  virtualQuoteReserve: string;
  buybackFeeRecipient: string;
}

export interface BuybackBurnInstructionEstimate {
  accountMetas: number;
  uniqueTransactionAccounts: number;
  instructionDataBytes: number;
  estimatedLegacyTransactionBytes: number;
}

export function deriveBuybackBurnAuthority(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(BUYBACK_BURN_AUTHORITY_SEED)],
    programId,
  )[0];
}

export function deriveBuybackBurnAtas(authority: PublicKey): {
  lckd: PublicKey;
  wsol: PublicKey;
} {
  return {
    lckd: getAssociatedTokenAddressSync(LCKD_MINT, authority, true, TOKEN_2022_PROGRAM_ID),
    wsol: getAssociatedTokenAddressSync(NATIVE_MINT, authority, true, TOKEN_PROGRAM_ID),
  };
}

export function minimumOutputForSlippage(expected: bigint, slippageBps: number): bigint {
  assertSlippageBps(slippageBps);
  if (expected <= BigInt(0)) throw new Error("Expected LCKD output must be positive");
  const minimum = (expected * BigInt(10_000 - slippageBps)) / BigInt(10_000);
  if (minimum <= BigInt(0)) throw new Error("Minimum LCKD output must be positive");
  return minimum;
}

export function validatePumpBuyExactQuoteInInstruction(
  instruction: TransactionInstruction,
  authority: PublicKey,
  minimumBaseAmountOut: bigint,
): void {
  if (!instruction.programId.equals(PUMP_AMM_PROGRAM_ID)) {
    throw new Error("Buyback must invoke the canonical Pump AMM program");
  }
  if (instruction.keys.length !== PUMP_BUY_EXACT_QUOTE_IN_ACCOUNT_COUNT) {
    throw new Error("Pump buyExactQuoteIn account count is invalid");
  }
  if (instruction.data.length !== PUMP_BUY_EXACT_QUOTE_IN_DATA_LENGTH) {
    throw new Error("Pump buyExactQuoteIn data length is invalid");
  }
  if (!instruction.data.subarray(0, 8).equals(PUMP_BUY_EXACT_QUOTE_IN_DISCRIMINATOR)) {
    throw new Error("Pump instruction is not buyExactQuoteIn");
  }
  if (readU64LE(instruction.data, 8) !== BigInt(BUYBACK_BURN_LAMPORTS)) {
    throw new Error("Pump spendable quote input must be exactly 0.1 SOL");
  }
  if (readU64LE(instruction.data, 16) !== minimumBaseAmountOut) {
    throw new Error("Pump minimum LCKD output does not match the frozen quote");
  }
  if (instruction.data[24] !== 0) {
    throw new Error("Pump volume tracking must be disabled for the PDA authority");
  }
  assertPumpAccountPrefix(instruction.keys, authority);
}

export function wrapBuybackBurnInstruction(params: {
  programId: PublicKey;
  launcher: PublicKey;
  authority: PublicKey;
  pumpInstruction: TransactionInstruction;
  minimumBaseAmountOut: bigint;
}): TransactionInstruction {
  const expectedAuthority = deriveBuybackBurnAuthority(params.programId);
  if (!params.authority.equals(expectedAuthority)) {
    throw new Error("Buyback authority is not the canonical program PDA");
  }
  if (params.launcher.equals(params.authority)) {
    throw new Error("Launcher cannot be the buyback authority PDA");
  }
  validatePumpBuyExactQuoteInInstruction(
    params.pumpInstruction,
    params.authority,
    params.minimumBaseAmountOut,
  );

  const pumpKeys = params.pumpInstruction.keys.map((meta, index) => ({
    ...meta,
    isSigner: index === 1 ? false : meta.isSigner,
    isWritable: index === 3 || index === 9 || index === 24 ? true : meta.isWritable,
  }));
  return new TransactionInstruction({
    programId: params.programId,
    keys: [{ pubkey: params.launcher, isSigner: true, isWritable: true }, ...pumpKeys],
    data: encodeOuterData(params.minimumBaseAmountOut),
  });
}

export function assertBuybackBurnSnapshot(snapshot: BuybackBurnQuoteSnapshot): void {
  if (snapshot.version !== 1 || !Number.isSafeInteger(snapshot.observedSlot)) {
    throw new Error("Buyback quote snapshot version or slot is invalid");
  }
  if (snapshot.pool !== LCKD_CANONICAL_PUMP_POOL.toBase58()) {
    throw new Error("Buyback quote does not use the canonical LCKD pool");
  }
  if (snapshot.spendableQuoteIn !== String(BUYBACK_BURN_LAMPORTS)) {
    throw new Error("Buyback quote input must be exactly 0.1 SOL");
  }
  assertSlippageBps(snapshot.slippageBps);
  const expected = parsePositiveU64(snapshot.expectedBaseAmountOut, "expected output");
  const minimum = parsePositiveU64(snapshot.minimumBaseAmountOut, "minimum output");
  if (minimum !== minimumOutputForSlippage(expected, snapshot.slippageBps)) {
    throw new Error("Buyback quote minimum output does not match slippage");
  }
  parsePositiveU64(snapshot.poolBaseReserve, "base reserve");
  parsePositiveU64(snapshot.poolQuoteReserve, "quote reserve");
  parseUnsignedU64(snapshot.virtualQuoteReserve, "virtual quote reserve");
  new PublicKey(snapshot.buybackFeeRecipient);
  new PublicKey(snapshot.authority);
}

export function estimateBuybackBurnInstruction(
  instruction: TransactionInstruction,
  feePayer: PublicKey,
): BuybackBurnInstructionEstimate {
  const uniqueAccounts = new Set([
    feePayer.toBase58(),
    instruction.programId.toBase58(),
    ...instruction.keys.map(({ pubkey }) => pubkey.toBase58()),
  ]).size;
  const instructionBytes = 1 + 1 + instruction.keys.length + 1 + instruction.data.length;
  const messageBytes = 3 + 1 + uniqueAccounts * 32 + 32 + 1 + instructionBytes;
  return {
    accountMetas: instruction.keys.length,
    uniqueTransactionAccounts: uniqueAccounts,
    instructionDataBytes: instruction.data.length,
    estimatedLegacyTransactionBytes: 1 + 64 + messageBytes,
  };
}

function assertPumpAccountPrefix(keys: AccountMeta[], authority: PublicKey): void {
  const atas = deriveBuybackBurnAtas(authority);
  const fixedAccounts = new Map<number, PublicKey>([
    [0, LCKD_CANONICAL_PUMP_POOL], [1, authority], [2, GLOBAL_CONFIG_PDA],
    [3, LCKD_MINT], [4, NATIVE_MINT], [5, atas.lckd], [6, atas.wsol],
    [7, getAssociatedTokenAddressSync(
      LCKD_MINT,
      LCKD_CANONICAL_PUMP_POOL,
      true,
      TOKEN_2022_PROGRAM_ID,
    )],
    [8, getAssociatedTokenAddressSync(NATIVE_MINT, LCKD_CANONICAL_PUMP_POOL, true)],
    [11, TOKEN_2022_PROGRAM_ID], [12, TOKEN_PROGRAM_ID], [13, SystemProgram.programId],
    [14, ASSOCIATED_TOKEN_PROGRAM_ID], [15, PUMP_AMM_EVENT_AUTHORITY_PDA],
    [16, PUMP_AMM_PROGRAM_ID], [19, GLOBAL_VOLUME_ACCUMULATOR_PDA],
    [20, userVolumeAccumulatorPda(authority)], [21, PUMP_AMM_FEE_CONFIG_PDA],
    [22, PUMP_FEE_PROGRAM_ID], [23, poolV2Pda(LCKD_MINT)],
    [9, PUMP_PROTOCOL_FEE_RECIPIENT], [18, PUMP_CREATOR_VAULT_AUTHORITY],
    [24, PUMP_BUYBACK_FEE_RECIPIENT],
  ]);
  fixedAccounts.forEach((expected, accountIndex) => {
    if (!keys[accountIndex]?.pubkey.equals(expected)) {
      throw new Error(`Pump account ${accountIndex} is not canonical`);
    }
  });
  const writableIndexes = new Set([0, 1, 5, 6, 7, 8, 10, 17, 20, 25]);
  keys.forEach((key, index) => {
    if (key.isSigner !== (index === 1) || key.isWritable !== writableIndexes.has(index)) {
      throw new Error(`Pump account ${index} privileges are invalid`);
    }
  });
  const relationalAtas: Array<[number, number]> = [[10, 9], [17, 18], [25, 24]];
  relationalAtas.forEach(([ataIndex, ownerIndex]) => {
    const expectedAta = getAssociatedTokenAddressSync(
      NATIVE_MINT,
      keys[ownerIndex].pubkey,
      true,
      TOKEN_PROGRAM_ID,
    );
    if (!keys[ataIndex].pubkey.equals(expectedAta)) {
      throw new Error(`Pump account ${ataIndex} is not the canonical WSOL ATA`);
    }
  });
}

function encodeOuterData(minimumBaseAmountOut: bigint): Buffer {
  parsePositiveU64(minimumBaseAmountOut.toString(), "minimum output");
  const data = Buffer.alloc(9);
  data[0] = BUYBACK_BURN_OUTER_DISCRIMINATOR;
  writeU64LE(data, minimumBaseAmountOut, 1);
  return data;
}

function assertSlippageBps(slippageBps: number): void {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > MAX_BUYBACK_SLIPPAGE_BPS) {
    throw new Error(`Buyback slippage must be between 0 and ${MAX_BUYBACK_SLIPPAGE_BPS} bps`);
  }
}

function parsePositiveU64(value: string, label: string): bigint {
  const parsed = parseUnsignedU64(value, label);
  if (parsed === BigInt(0)) throw new Error(`Buyback ${label} must be positive`);
  return parsed;
}

function parseUnsignedU64(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`Buyback ${label} must be an integer`);
  const parsed = BigInt(value);
  if (parsed > BigInt("18446744073709551615")) throw new Error(`Buyback ${label} exceeds u64`);
  return parsed;
}
