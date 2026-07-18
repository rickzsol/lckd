import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import {
  PUMPFUN_PROGRAM_ID,
} from "./constants";
import {
  PUMP_CREATE_DISCRIMINATOR,
  PUMP_CREATE_V2_DISCRIMINATOR,
  type PumpCreateData,
  validatePumpCreateInstruction,
} from "./pumpCreateValidation";
import { validatePumpBuyInstruction } from "./pumpBuyValidation";
import { ICluster } from "@streamflow/stream";
import { readU64LE } from "./u64";

const STREAMFLOW_PROGRAM_IDS: Record<ICluster, PublicKey> = {
  [ICluster.Mainnet]: new PublicKey("strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m"),
  [ICluster.Devnet]: new PublicKey("HqDGZjaVRXJ9MGRQEw7qDc2rAr6iH1n1kAQdCZaCMfMZ"),
  [ICluster.Testnet]: new PublicKey("HqDGZjaVRXJ9MGRQEw7qDc2rAr6iH1n1kAQdCZaCMfMZ"),
  [ICluster.Local]: new PublicKey("HqDGZjaVRXJ9MGRQEw7qDc2rAr6iH1n1kAQdCZaCMfMZ"),
};
const STREAMFLOW_FEE_ORACLES: Record<ICluster, PublicKey> = {
  [ICluster.Mainnet]: new PublicKey("B743wFVk2pCYhV91cn287e1xY7f1vt4gdY48hhNiuQmT"),
  [ICluster.Devnet]: new PublicKey("Aa2JJfFzUN3V54DXUHRBJowFw416xfZHpPk9DaNy3iYs"),
  [ICluster.Testnet]: new PublicKey("Aa2JJfFzUN3V54DXUHRBJowFw416xfZHpPk9DaNy3iYs"),
  [ICluster.Local]: new PublicKey("Aa2JJfFzUN3V54DXUHRBJowFw416xfZHpPk9DaNy3iYs"),
};
const STREAMFLOW_TREASURY = new PublicKey("5SEpbdjFK5FxwTvfsGMXVQTD2v4M2c5tyRTxhdsPkgDw");
const STREAMFLOW_WITHDRAWOR = new PublicKey("wdrwhnCv4pzW8beKsbPa4S2UDZrXenjg16KJdKSpb5u");

const PUMPPORTAL_CREATE_ALLOWED_PROGRAM_IDS = new Set([
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  ComputeBudgetProgram.programId.toBase58(),
  PUMPFUN_PROGRAM_ID.toBase58(),
]);
const STREAMFLOW_CREATE_DISCRIMINATOR = "181ec828051c0777";

export interface PumpPortalCreateExpectation {
  name: string;
  symbol: string;
  metadataUri: string;
  buyAmountSol: number;
  slippagePercent: number;
  priorityFeeSol: number;
}

function parseComputeBudget(data: Buffer): { unitLimit?: number; unitPrice?: bigint } {
  const discriminator = data[0];
  if (discriminator === 2 && data.length === 5) {
    const unitLimit = data.readUInt32LE(1);
    if (unitLimit < 1 || unitLimit > 1_400_000) {
      throw new Error("Compute unit limit is invalid");
    }
    return { unitLimit };
  }
  if (discriminator === 3 && data.length === 9) {
    return { unitPrice: readU64LE(data, 1) };
  }
  throw new Error("PumpPortal transaction contains an unsupported compute instruction");
}

function assertExactSigners(
  actualSigners: PublicKey[],
  expectedSigners: PublicKey[],
  label: string,
): void {
  if (actualSigners.length !== expectedSigners.length) {
    throw new Error(`${label} requires an unexpected number of signers`);
  }
  const expected = new Set(expectedSigners.map((key) => key.toBase58()));
  if (actualSigners.some((key) => !expected.has(key.toBase58()))) {
    throw new Error(`${label} contains an unexpected required signer`);
  }
}

function assertAllowedPrograms(
  programIds: PublicKey[],
  allowedPrograms: Set<string>,
  label: string,
): void {
  const unexpectedProgram = programIds.find(
    (programId) => !allowedPrograms.has(programId.toBase58()),
  );
  if (unexpectedProgram) {
    throw new Error(`${label} contains unapproved program ${unexpectedProgram.toBase58()}`);
  }
}

export function validatePumpPortalCreateTransaction(
  txBytes: Uint8Array,
  wallet: PublicKey,
  mint: PublicKey,
  expectation: PumpPortalCreateExpectation,
): VersionedTransaction {
  if (
    !Number.isFinite(expectation.buyAmountSol) ||
    expectation.buyAmountSol <= 0 ||
    !Number.isFinite(expectation.slippagePercent) ||
    expectation.slippagePercent < 0 ||
    !Number.isFinite(expectation.priorityFeeSol) ||
    expectation.priorityFeeSol < 0
  ) {
    throw new Error("PumpPortal transaction expectation is invalid");
  }
  const transaction = VersionedTransaction.deserialize(txBytes);
  const message = transaction.message;
  if (message.addressTableLookups.length > 0) {
    throw new Error("PumpPortal transaction uses uninspectable address lookup tables");
  }

  const accountKeys = message.staticAccountKeys;
  if (!accountKeys[0]?.equals(wallet)) throw new Error("PumpPortal fee payer mismatch");
  assertExactSigners(
    accountKeys.slice(0, message.header.numRequiredSignatures),
    [wallet, mint],
    "PumpPortal create transaction",
  );

  const mintIndex = accountKeys.findIndex((key) => key.equals(mint));
  if (mintIndex < 0) throw new Error("PumpPortal create transaction is missing the mint");

  const programIds = message.compiledInstructions.map((instruction) => {
    const programId = accountKeys[instruction.programIdIndex];
    if (!programId) throw new Error("PumpPortal program ID is not statically inspectable");
    return programId;
  });
  assertAllowedPrograms(
    programIds,
    PUMPPORTAL_CREATE_ALLOWED_PROGRAM_IDS,
    "PumpPortal transaction",
  );

  let createCount = 0;
  let buyCount = 0;
  let createData: PumpCreateData | null = null;
  let computeUnitLimit = 1_400_000;
  let computeUnitPrice = BigInt(0);
  let hasComputeUnitLimit = false;
  let hasComputeUnitPrice = false;
  for (const instruction of message.compiledInstructions) {
    const programId = accountKeys[instruction.programIdIndex];
    const data = Buffer.from(instruction.data);
    const instructionAccounts = [...instruction.accountKeyIndexes].map(
      (index) => accountKeys[index],
    );

    if (programId.equals(ComputeBudgetProgram.programId)) {
      const compute = parseComputeBudget(data);
      if (compute.unitLimit !== undefined) {
        if (hasComputeUnitLimit) throw new Error("PumpPortal transaction repeats compute unit limit");
        computeUnitLimit = compute.unitLimit;
        hasComputeUnitLimit = true;
      }
      if (compute.unitPrice !== undefined) {
        if (hasComputeUnitPrice) throw new Error("PumpPortal transaction repeats compute unit price");
        computeUnitPrice = compute.unitPrice;
        hasComputeUnitPrice = true;
      }
      continue;
    }
    if (programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      const tokenProgram = instructionAccounts[5];
      if (
        !tokenProgram?.equals(TOKEN_PROGRAM_ID) &&
        !tokenProgram?.equals(TOKEN_2022_PROGRAM_ID)
      ) {
        throw new Error("PumpPortal token account uses an unsupported token program");
      }
      const expectedAta = getAssociatedTokenAddressSync(
        mint,
        wallet,
        false,
        tokenProgram,
      );
      if (
        (data.length !== 0 && !(data.length === 1 && data[0] === 1)) ||
        !instructionAccounts[0]?.equals(wallet) ||
        !instructionAccounts[1]?.equals(expectedAta) ||
        !instructionAccounts[2]?.equals(wallet) ||
        !instructionAccounts[3]?.equals(mint) ||
        !instructionAccounts[4]?.equals(SystemProgram.programId) ||
        !instructionAccounts[5]?.equals(tokenProgram)
      ) {
        throw new Error("PumpPortal transaction contains an unexpected token account creation");
      }
      continue;
    }

    const discriminator = data.subarray(0, 8).toString("hex");
    if (
      discriminator === PUMP_CREATE_DISCRIMINATOR ||
      discriminator === PUMP_CREATE_V2_DISCRIMINATOR
    ) {
      if (createData) throw new Error("PumpPortal transaction contains multiple creates");
      createData = validatePumpCreateInstruction(data, instructionAccounts, wallet, mint, {
        name: expectation.name,
        symbol: expectation.symbol,
        metadataUri: expectation.metadataUri,
      });
      createCount += 1;
      continue;
    }

    if (!createData) throw new Error("Pump buy must follow the reviewed create instruction");
    const spendLimit = validatePumpBuyInstruction(
      data,
      instructionAccounts,
      wallet,
      mint,
      createData,
    );
    const allowedSpend = BigInt(
      Math.ceil(
        expectation.buyAmountSol *
          (1 + expectation.slippagePercent / 100) *
          1_000_000_000,
      ),
    );
    if (spendLimit > allowedSpend) throw new Error("Pump buy spend limit is excessive");
    buyCount += 1;
  }

  if (createCount !== 1 || buyCount !== 1) {
    throw new Error("PumpPortal transaction must contain one create and one buy instruction");
  }
  const priorityFeeLamports =
    (computeUnitPrice * BigInt(computeUnitLimit) + BigInt(999_999)) / BigInt(1_000_000);
  const approvedPriorityFeeLamports = BigInt(
    Math.ceil(expectation.priorityFeeSol * 1_000_000_000),
  );
  if (priorityFeeLamports > approvedPriorityFeeLamports) {
    throw new Error("PumpPortal transaction priority fee is excessive");
  }

  return transaction;
}

export function validateStreamflowLockTransaction(
  transaction: Transaction,
  wallet: PublicKey,
  mint: PublicKey,
  metadataSigner: PublicKey,
  cluster: ICluster,
  tokenProgram: PublicKey,
  amount: BN,
  unlockTimestamp: number,
): void {
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error("Lock mint uses an unsupported token program");
  }
  const message = transaction.compileMessage();
  if (!message.accountKeys[0]?.equals(wallet)) throw new Error("Lock fee payer mismatch");
  assertExactSigners(
    message.accountKeys.slice(0, message.header.numRequiredSignatures),
    [wallet, metadataSigner],
    "Streamflow lock transaction",
  );

  const streamflowProgram = STREAMFLOW_PROGRAM_IDS[cluster];
  const expectedComputePrice = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 100_000,
  });
  const expectedComputeLimit = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  if (
    transaction.instructions.length !== 3 ||
    !transaction.instructions[0].programId.equals(ComputeBudgetProgram.programId) ||
    !transaction.instructions[0].data.equals(expectedComputePrice.data) ||
    !transaction.instructions[1].programId.equals(ComputeBudgetProgram.programId) ||
    !transaction.instructions[1].data.equals(expectedComputeLimit.data) ||
    !transaction.instructions[2].programId.equals(streamflowProgram)
  ) {
    throw new Error("Lock transaction instructions do not match the reviewed Streamflow build");
  }

  const instruction = transaction.instructions[2];
  const data = instruction.data;
  const accounts = instruction.keys;
  const walletAta = getAssociatedTokenAddressSync(mint, wallet, false, tokenProgram);
  const treasuryAta = getAssociatedTokenAddressSync(
    mint,
    STREAMFLOW_TREASURY,
    false,
    tokenProgram,
  );
  const [escrow] = PublicKey.findProgramAddressSync(
    [Buffer.from("strm"), metadataSigner.toBuffer()],
    streamflowProgram,
  );
  const expectedAccounts = [
    { pubkey: wallet, isSigner: true, isWritable: true },
    { pubkey: walletAta, isSigner: false, isWritable: true },
    { pubkey: wallet, isSigner: false, isWritable: true },
    { pubkey: metadataSigner, isSigner: true, isWritable: true },
    { pubkey: escrow, isSigner: false, isWritable: true },
    { pubkey: walletAta, isSigner: false, isWritable: true },
    { pubkey: STREAMFLOW_TREASURY, isSigner: false, isWritable: true },
    { pubkey: treasuryAta, isSigner: false, isWritable: true },
    { pubkey: STREAMFLOW_WITHDRAWOR, isSigner: false, isWritable: true },
    { pubkey: wallet, isSigner: false, isWritable: true },
    { pubkey: walletAta, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: STREAMFLOW_FEE_ORACLES[cluster], isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: streamflowProgram, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const hasExactAccounts =
    accounts.length === expectedAccounts.length &&
    accounts.every((account, index) => {
      const expected = expectedAccounts[index];
      return (
        account.pubkey.equals(expected.pubkey) &&
        account.isSigner === expected.isSigner &&
        account.isWritable === expected.isWritable
      );
    });
  if (
    data.length < 138 ||
    data.subarray(0, 8).toString("hex") !== STREAMFLOW_CREATE_DISCRIMINATOR ||
    !hasExactAccounts
  ) {
    throw new Error("Lock transaction account layout does not match the requested time lock");
  }

  const start = readU64LE(data, 8);
  const encodedAmount = readU64LE(data, 16);
  const period = readU64LE(data, 24);
  const amountPerPeriod = readU64LE(data, 32);
  const cliff = readU64LE(data, 40);
  const cliffAmount = readU64LE(data, 48);
  const withdrawalFrequency = readU64LE(data, 126);
  const hasDisabledPermissions = [56, 57, 58, 59, 60, 61].every(
    (offset) => data[offset] === 0,
  );
  const hasZeroPadding = data.subarray(138).every((value) => value === 0);
  if (
    data.length !== 148 ||
    start !== BigInt(unlockTimestamp) ||
    cliff !== start ||
    encodedAmount !== BigInt(amount.toString()) ||
    cliffAmount !== encodedAmount ||
    period !== BigInt(1) ||
    amountPerPeriod !== BigInt(1) ||
    withdrawalFrequency !== period ||
    data[134] !== 1 ||
    data[135] !== 0 ||
    data[136] !== 1 ||
    data[137] !== 0 ||
    !hasZeroPadding ||
    !hasDisabledPermissions
  ) {
    throw new Error("Streamflow instruction is not the requested immutable time lock");
  }
}

function simulationError(label: string, error: unknown, logs?: string[] | null): Error {
  const detail = typeof error === "string" ? error : JSON.stringify(error);
  const logTail = logs?.slice(-4).join(" | ");
  return new Error(`${label} simulation failed: ${detail}${logTail ? ` (${logTail})` : ""}`);
}

export async function simulateVersionedTransactionOrThrow(
  connection: Connection,
  transaction: VersionedTransaction,
  label: string,
  spendLimit?: { wallet: PublicKey; maxLamports: number },
): Promise<void> {
  const preBalance = spendLimit
    ? await connection.getBalance(spendLimit.wallet, "confirmed")
    : null;
  const simulation = await connection.simulateTransaction(transaction, {
    commitment: "confirmed",
    sigVerify: true,
    ...(spendLimit
      ? {
          accounts: {
            encoding: "base64" as const,
            addresses: [spendLimit.wallet.toBase58()],
          },
        }
      : {}),
  });
  if (simulation.value.err) {
    throw simulationError(label, simulation.value.err, simulation.value.logs);
  }
  if (spendLimit && preBalance !== null) {
    const postBalance = simulation.value.accounts?.[0]?.lamports;
    if (typeof postBalance !== "number") {
      throw new Error(`${label} simulation did not return the wallet balance`);
    }
    if (preBalance - postBalance > spendLimit.maxLamports) {
      throw new Error(`${label} would spend more SOL than approved`);
    }
  }
}

export async function simulateLegacyTransactionOrThrow(
  connection: Connection,
  transaction: Transaction,
  label: string,
): Promise<void> {
  if (!transaction.verifySignatures()) throw new Error(`${label} has invalid signatures`);
  const simulation = await connection.simulateTransaction(transaction);
  if (simulation.value.err) {
    throw simulationError(label, simulation.value.err, simulation.value.logs);
  }
}
