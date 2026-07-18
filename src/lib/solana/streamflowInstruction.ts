import {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  createStreamInstruction,
  deriveEscrowPDA,
  FEE_ORACLE_PUBLIC_KEY,
  ICluster,
  PROGRAM_ID,
  STREAMFLOW_TREASURY_PUBLIC_KEY,
  WITHDRAWOR_PUBLIC_KEY,
} from "@streamflow/stream";
import BN from "bn.js";
import { writeU64LE } from "./u64";

export const STREAMFLOW_CREATE_DATA_LENGTH = 148;
export const STREAMFLOW_CREATE_ACCOUNT_COUNT = 18;
export const STREAMFLOW_V13_PROGRAM_ID = new PublicKey(PROGRAM_ID[ICluster.Mainnet]);
export const STREAMFLOW_V13_FEE_ORACLE = new PublicKey(
  FEE_ORACLE_PUBLIC_KEY[ICluster.Mainnet],
);

const STREAMFLOW_CREATE_DISCRIMINATOR = Buffer.from("181ec828051c0777", "hex");
const STREAM_NAME_MAX_BYTES = 64;
const STREAM_NAME_OFFSET = 62;
const U64_MAX = new BN("18446744073709551615");
const ONE = new BN(1);

export interface StreamflowCreateInstructionParams {
  sender: PublicKey;
  mint: PublicKey;
  metadata: PublicKey;
  amount: BN;
  unlockTimestamp: number;
  name: string;
}

export interface StreamflowInstructionExpectation {
  programId: PublicKey;
  keys: readonly AccountMeta[];
  data: Buffer;
  senderTokenAccount: PublicKey;
  escrowTokenAccount: PublicKey;
  treasuryTokenAccount: PublicKey;
}

function validateParams(params: StreamflowCreateInstructionParams): Buffer {
  if (!BN.isBN(params.amount) || params.amount.lt(ONE) || params.amount.gt(U64_MAX)) {
    throw new Error("Streamflow lock amount must be a positive u64");
  }
  if (!Number.isSafeInteger(params.unlockTimestamp) || params.unlockTimestamp < 1) {
    throw new Error("Streamflow unlock timestamp must be a positive safe integer");
  }

  const nameBytes = Buffer.from(params.name, "utf8");
  if (nameBytes.length < 1 || nameBytes.length > STREAM_NAME_MAX_BYTES) {
    throw new Error("Streamflow name must contain between 1 and 64 UTF-8 bytes");
  }
  return nameBytes;
}

function buildExpectedData(
  params: StreamflowCreateInstructionParams,
  nameBytes: Buffer,
): Buffer {
  const data = Buffer.alloc(STREAMFLOW_CREATE_DATA_LENGTH);
  STREAMFLOW_CREATE_DISCRIMINATOR.copy(data, 0);
  writeU64LE(data, BigInt(params.unlockTimestamp), 8);
  writeU64LE(data, BigInt(params.amount.toString()), 16);
  writeU64LE(data, BigInt(1), 24);
  writeU64LE(data, BigInt(1), 32);
  writeU64LE(data, BigInt(params.unlockTimestamp), 40);
  writeU64LE(data, BigInt(params.amount.toString()), 48);
  nameBytes.copy(data, STREAM_NAME_OFFSET);
  writeU64LE(data, BigInt(1), 126);
  data[134] = 1;
  data[136] = 1;
  return data;
}

export function createStreamflowInstructionExpectation(
  params: StreamflowCreateInstructionParams,
): StreamflowInstructionExpectation {
  const nameBytes = validateParams(params);
  const senderTokenAccount = getAssociatedTokenAddressSync(
    params.mint,
    params.sender,
    false,
    TOKEN_PROGRAM_ID,
  );
  const treasuryTokenAccount = getAssociatedTokenAddressSync(
    params.mint,
    STREAMFLOW_TREASURY_PUBLIC_KEY,
    false,
    TOKEN_PROGRAM_ID,
  );
  const escrowTokenAccount = deriveEscrowPDA(STREAMFLOW_V13_PROGRAM_ID, params.metadata);
  const keys: AccountMeta[] = [
    { pubkey: params.sender, isSigner: true, isWritable: true },
    { pubkey: senderTokenAccount, isSigner: false, isWritable: true },
    { pubkey: params.sender, isSigner: false, isWritable: true },
    { pubkey: params.metadata, isSigner: true, isWritable: true },
    { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
    { pubkey: senderTokenAccount, isSigner: false, isWritable: true },
    { pubkey: STREAMFLOW_TREASURY_PUBLIC_KEY, isSigner: false, isWritable: true },
    { pubkey: treasuryTokenAccount, isSigner: false, isWritable: true },
    { pubkey: WITHDRAWOR_PUBLIC_KEY, isSigner: false, isWritable: true },
    { pubkey: params.sender, isSigner: false, isWritable: true },
    { pubkey: senderTokenAccount, isSigner: false, isWritable: true },
    { pubkey: params.mint, isSigner: false, isWritable: false },
    { pubkey: STREAMFLOW_V13_FEE_ORACLE, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: STREAMFLOW_V13_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return {
    programId: STREAMFLOW_V13_PROGRAM_ID,
    keys,
    data: buildExpectedData(params, nameBytes),
    senderTokenAccount,
    escrowTokenAccount,
    treasuryTokenAccount,
  };
}

export function validateStreamflowCreateInstruction(
  instruction: TransactionInstruction,
  expectation: StreamflowInstructionExpectation,
): TransactionInstruction {
  const hasExactAccounts =
    instruction.keys.length === STREAMFLOW_CREATE_ACCOUNT_COUNT &&
    instruction.keys.every((account, index) => {
      const expected = expectation.keys[index];
      return (
        expected !== undefined &&
        account.pubkey.equals(expected.pubkey) &&
        account.isSigner === expected.isSigner &&
        account.isWritable === expected.isWritable
      );
    });

  if (
    !instruction.programId.equals(expectation.programId) ||
    expectation.keys.length !== STREAMFLOW_CREATE_ACCOUNT_COUNT ||
    instruction.data.length !== STREAMFLOW_CREATE_DATA_LENGTH ||
    !instruction.data.equals(expectation.data) ||
    !hasExactAccounts
  ) {
    throw new Error("Streamflow instruction does not match the immutable v13 token lock");
  }
  return instruction;
}

export async function buildStreamflowCreateInstruction(
  params: StreamflowCreateInstructionParams,
): Promise<TransactionInstruction> {
  const expectation = createStreamflowInstructionExpectation(params);
  const instruction = await createStreamInstruction(
    {
      start: new BN(params.unlockTimestamp),
      depositedAmount: params.amount.clone(),
      period: ONE,
      amountPerPeriod: ONE,
      cliff: new BN(params.unlockTimestamp),
      cliffAmount: params.amount.clone(),
      cancelableBySender: false,
      cancelableByRecipient: false,
      automaticWithdrawal: false,
      transferableBySender: false,
      transferableByRecipient: false,
      canTopup: false,
      canUpdateRate: false,
      canPause: false,
      name: params.name,
      withdrawFrequency: ONE,
    },
    STREAMFLOW_V13_PROGRAM_ID,
    {
      sender: params.sender,
      senderTokens: expectation.senderTokenAccount,
      recipient: params.sender,
      recipientTokens: expectation.senderTokenAccount,
      metadata: params.metadata,
      escrowTokens: expectation.escrowTokenAccount,
      streamflowTreasury: STREAMFLOW_TREASURY_PUBLIC_KEY,
      streamflowTreasuryTokens: expectation.treasuryTokenAccount,
      partner: params.sender,
      partnerTokens: expectation.senderTokenAccount,
      mint: params.mint,
      feeOracle: STREAMFLOW_V13_FEE_ORACLE,
      rent: SYSVAR_RENT_PUBKEY,
      timelockProgram: STREAMFLOW_V13_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      withdrawor: WITHDRAWOR_PUBLIC_KEY,
      systemProgram: SystemProgram.programId,
    },
  );

  return validateStreamflowCreateInstruction(instruction, expectation);
}
