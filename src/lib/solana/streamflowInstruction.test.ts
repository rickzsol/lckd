import assert from "node:assert/strict";
import test from "node:test";
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  deriveEscrowPDA,
  STREAMFLOW_TREASURY_PUBLIC_KEY,
} from "@streamflow/stream";
import BN from "bn.js";
import {
  buildStreamflowCreateInstruction,
  createStreamflowInstructionExpectation,
  STREAMFLOW_CREATE_ACCOUNT_COUNT,
  STREAMFLOW_CREATE_DATA_LENGTH,
  STREAMFLOW_V13_PROGRAM_ID,
  validateStreamflowCreateInstruction,
  type StreamflowCreateInstructionParams,
} from "./streamflowInstruction";

const params: StreamflowCreateInstructionParams = {
  sender: Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => 1)).publicKey,
  mint: new PublicKey("8LKEG3x3CAqRZg18tbrGQKM6z35xgGUYrxnVj8xf9nJT"),
  metadata: Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => 2)).publicKey,
  amount: new BN("998103000000"),
  unlockTimestamp: 1_900_000_000,
  name: "LCKD atomic lock",
};

function copyInstruction(instruction: TransactionInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: instruction.programId,
    keys: instruction.keys.map((key) => ({ ...key })),
    data: Buffer.from(instruction.data),
  });
}

test("builds the exact 18-account, 148-byte Streamflow v13 instruction", async () => {
  const expectation = createStreamflowInstructionExpectation(params);
  const instruction = await buildStreamflowCreateInstruction(params);

  assert.equal(instruction.keys.length, STREAMFLOW_CREATE_ACCOUNT_COUNT);
  assert.equal(instruction.data.length, STREAMFLOW_CREATE_DATA_LENGTH);
  assert(instruction.programId.equals(STREAMFLOW_V13_PROGRAM_ID));
  assert.deepEqual(instruction.data, expectation.data);
  assert.doesNotThrow(() => validateStreamflowCreateInstruction(instruction, expectation));
  assert.equal(instruction.data.subarray(0, 8).toString("hex"), "181ec828051c0777");
  assert.equal(instruction.data.readBigUInt64LE(8), BigInt(params.unlockTimestamp));
  assert.equal(instruction.data.readBigUInt64LE(16), BigInt(params.amount.toString()));
  assert.equal(instruction.data.readBigUInt64LE(24), BigInt(1));
  assert.equal(instruction.data.readBigUInt64LE(32), BigInt(1));
  assert.equal(instruction.data.readBigUInt64LE(40), BigInt(params.unlockTimestamp));
  assert.equal(instruction.data.readBigUInt64LE(48), BigInt(params.amount.toString()));
  assert.equal(instruction.data.readBigUInt64LE(126), BigInt(1));
  assert.deepEqual([...instruction.data.subarray(56, 62)], [0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...instruction.data.subarray(134, 138)], [1, 0, 1, 0]);
  assert(instruction.data.subarray(138).every((byte) => byte === 0));
});

test("derives legacy-token ATAs and the Streamflow escrow PDA locally", () => {
  const expectation = createStreamflowInstructionExpectation(params);
  const senderAta = getAssociatedTokenAddressSync(
    params.mint,
    params.sender,
    false,
    TOKEN_PROGRAM_ID,
  );
  const treasuryAta = getAssociatedTokenAddressSync(
    params.mint,
    STREAMFLOW_TREASURY_PUBLIC_KEY,
    false,
    TOKEN_PROGRAM_ID,
  );
  const escrow = deriveEscrowPDA(STREAMFLOW_V13_PROGRAM_ID, params.metadata);

  assert(expectation.senderTokenAccount.equals(senderAta));
  assert(expectation.treasuryTokenAccount.equals(treasuryAta));
  assert(expectation.escrowTokenAccount.equals(escrow));
  assert(expectation.keys[1]?.pubkey.equals(senderAta));
  assert(expectation.keys[4]?.pubkey.equals(escrow));
  assert(expectation.keys[7]?.pubkey.equals(treasuryAta));
  assert(expectation.keys[15]?.pubkey.equals(TOKEN_PROGRAM_ID));
});

test("sets only sender and metadata as signers with exact permissions", async () => {
  const instruction = await buildStreamflowCreateInstruction(params);
  assert.deepEqual(
    instruction.keys.map(({ isSigner, isWritable }) => [isSigner, isWritable]),
    [
      [true, true], [false, true], [false, true], [true, true],
      [false, true], [false, true], [false, true], [false, true],
      [false, true], [false, true], [false, true], [false, false],
      [false, false], [false, false], [false, false], [false, false],
      [false, false], [false, false],
    ],
  );
});

test("accepts a 64-byte UTF-8 name and rejects out-of-bounds names", () => {
  const exactName = "é".repeat(32);
  const expectation = createStreamflowInstructionExpectation({ ...params, name: exactName });
  assert.equal(expectation.data.subarray(62, 126).toString("utf8"), exactName);
  assert.throws(
    () => createStreamflowInstructionExpectation({ ...params, name: "" }),
    /between 1 and 64 UTF-8 bytes/,
  );
  assert.throws(
    () => createStreamflowInstructionExpectation({ ...params, name: `${exactName}a` }),
    /between 1 and 64 UTF-8 bytes/,
  );
});

test("rejects invalid amount and unlock timestamps", () => {
  for (const amount of [new BN(0), new BN(-1), new BN(2).pow(new BN(64))]) {
    assert.throws(
      () => createStreamflowInstructionExpectation({ ...params, amount }),
      /positive u64/,
    );
  }
  for (const unlockTimestamp of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => createStreamflowInstructionExpectation({ ...params, unlockTimestamp }),
      /positive safe integer/,
    );
  }
});

test("rejects mutations to the program, accounts, flags, and schedule", async () => {
  const instruction = await buildStreamflowCreateInstruction(params);
  const expectation = createStreamflowInstructionExpectation(params);
  const mutations: TransactionInstruction[] = [];

  const programMutation = copyInstruction(instruction);
  programMutation.programId = PublicKey.default;
  mutations.push(programMutation);

  const accountMutation = copyInstruction(instruction);
  accountMutation.keys[4] = { ...accountMutation.keys[4]!, pubkey: PublicKey.default };
  mutations.push(accountMutation);

  const signerMutation = copyInstruction(instruction);
  signerMutation.keys[3] = { ...signerMutation.keys[3]!, isSigner: false };
  mutations.push(signerMutation);

  for (const offset of [16, 24, 40, 56, 134, 147]) {
    const dataMutation = copyInstruction(instruction);
    dataMutation.data[offset] ^= 1;
    mutations.push(dataMutation);
  }

  for (const mutation of mutations) {
    assert.throws(
      () => validateStreamflowCreateInstruction(mutation, expectation),
      /immutable v13 token lock/,
    );
  }
});
