import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  GLOBAL_CONFIG_PDA,
  GLOBAL_VOLUME_ACCUMULATOR_PDA,
  PUMP_AMM_EVENT_AUTHORITY_PDA,
  PUMP_AMM_FEE_CONFIG_PDA,
  PUMP_AMM_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  poolV2Pda,
  userVolumeAccumulatorPda,
} from "@pump-fun/pump-swap-sdk";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import {
  BUYBACK_BURN_LAMPORTS,
  BUYBACK_BURN_PROGRAM_ID,
  LCKD_CANONICAL_PUMP_POOL,
  LCKD_MINT,
  PUMP_BUYBACK_FEE_RECIPIENT,
  PUMP_CREATOR_VAULT_AUTHORITY,
  PUMP_PROTOCOL_FEE_RECIPIENT,
  deriveBuybackBurnAtas,
  deriveBuybackBurnAuthority,
  wrapBuybackBurnInstruction,
} from "@/lib/solana/buybackBurn";
import { verifyBuybackBurnReceipt } from "./onchain";

const MINIMUM_OUTPUT = BigInt(123_456_789);
const BURNED_AMOUNT = BigInt(125_000_000);
const launcher = key(80);
const authority = deriveBuybackBurnAuthority(BUYBACK_BURN_PROGRAM_ID);
const atas = deriveBuybackBurnAtas(authority);

test("verifies the finalized buyback transfer, Pump execution, transfer, burn, and balances", () => {
  const fixture = receiptFixture();
  const verified = verifyBuybackBurnReceipt(fixture.params);
  assert.equal(verified.burnedRawAmount, BURNED_AMOUNT);
  assert.equal(verified.protocolLookupAddresses.length, 26);
});

test("rejects a burn that does not equal the purchased LCKD transfer", () => {
  const fixture = receiptFixture();
  const burn = fixture.params.innerInstructionGroups[0].instructions[3] as ReturnType<typeof parsed>;
  burn.parsed.info.amount = (BURNED_AMOUNT - BigInt(1)).toString();
  assert.throws(() => verifyBuybackBurnReceipt(fixture.params), /amounts are invalid/);
});

test("rejects nonzero final PDA WSOL and duplicate funding transfers", () => {
  const nonzero = receiptFixture();
  nonzero.params.postTokenBalances[1].uiTokenAmount.amount = "1";
  assert.throws(() => verifyBuybackBurnReceipt(nonzero.params), /balances were not restored/);

  const duplicate = receiptFixture();
  duplicate.params.innerInstructionGroups[0].instructions.unshift(
    duplicate.params.innerInstructionGroups[0].instructions[0],
  );
  assert.throws(() => verifyBuybackBurnReceipt(duplicate.params), /inner effects are invalid/);
});

test("accepts an exact pre-funding sweep of donated WSOL", () => {
  const donated = receiptFixture({ preWsol: "2", sweepAmount: "2" });
  assert.equal(verifyBuybackBurnReceipt(donated.params).burnedRawAmount, BURNED_AMOUNT);

  const incomplete = receiptFixture({ preWsol: "2", sweepAmount: "1" });
  assert.throws(() => verifyBuybackBurnReceipt(incomplete.params), /donated WSOL sweep is invalid/);
});

function receiptFixture(options: { preWsol?: string; sweepAmount?: string } = {}) {
  const pumpInstruction = buildPumpInstruction();
  const outerInstruction = wrapBuybackBurnInstruction({
    programId: BUYBACK_BURN_PROGRAM_ID,
    launcher,
    authority,
    pumpInstruction,
    minimumBaseAmountOut: MINIMUM_OUTPUT,
  });
  const accountKeys = transactionAccountKeys(outerInstruction);
  const lckdIndex = accountKeys.findIndex((account) => account.pubkey.equals(atas.lckd));
  const wsolIndex = accountKeys.findIndex((account) => account.pubkey.equals(atas.wsol));
  const tokenBalances = (lckdAmount: string, wsolAmount: string) => [
    balance(lckdIndex, LCKD_MINT, lckdAmount),
    balance(wsolIndex, NATIVE_MINT, wsolAmount),
  ];
  const innerInstructions = [
    ...(options.sweepAmount ? [parsed(TOKEN_PROGRAM_ID, "transfer", {
      source: atas.wsol.toBase58(),
      destination: pumpInstruction.keys[10].pubkey.toBase58(),
      authority: authority.toBase58(),
      amount: options.sweepAmount,
    })] : []),
    parsed(SystemProgram.programId, "transfer", {
      source: launcher.toBase58(),
      destination: atas.wsol.toBase58(),
      lamports: BUYBACK_BURN_LAMPORTS,
    }),
    raw(pumpInstruction),
    parsed(TOKEN_2022_PROGRAM_ID, "transferChecked", {
      source: pumpInstruction.keys[7].pubkey.toBase58(),
      destination: atas.lckd.toBase58(),
      authority: pumpInstruction.keys[0].pubkey.toBase58(),
      mint: LCKD_MINT.toBase58(),
      tokenAmount: { amount: BURNED_AMOUNT.toString() },
    }),
    parsed(TOKEN_2022_PROGRAM_ID, "burn", {
      account: atas.lckd.toBase58(),
      mint: LCKD_MINT.toBase58(),
      authority: authority.toBase58(),
      amount: BURNED_AMOUNT.toString(),
    }),
  ];
  return {
    params: {
      outerInstruction: raw(outerInstruction),
      innerInstructionGroups: [{ index: 6, instructions: innerInstructions }],
      accountKeys,
      preTokenBalances: tokenBalances("7", options.preWsol ?? "0"),
      postTokenBalances: tokenBalances("7", "0"),
      launcher,
      fee: {
        feeMode: "buybackBurn" as const,
        feeLamports: BUYBACK_BURN_LAMPORTS,
        feeLckdRaw: MINIMUM_OUTPUT.toString(),
        feeTreasury: authority.toBase58(),
      },
    },
  };
}

function buildPumpInstruction(): TransactionInstruction {
  const protocolRecipient = PUMP_PROTOCOL_FEE_RECIPIENT;
  const creatorAuthority = PUMP_CREATOR_VAULT_AUTHORITY;
  const buybackRecipient = PUMP_BUYBACK_FEE_RECIPIENT;
  const poolLckd = getAssociatedTokenAddressSync(
    LCKD_MINT,
    LCKD_CANONICAL_PUMP_POOL,
    true,
    TOKEN_2022_PROGRAM_ID,
  );
  const poolWsol = getAssociatedTokenAddressSync(NATIVE_MINT, LCKD_CANONICAL_PUMP_POOL, true);
  const keys = [
    meta(LCKD_CANONICAL_PUMP_POOL, true), meta(authority, true), meta(GLOBAL_CONFIG_PDA),
    meta(LCKD_MINT), meta(NATIVE_MINT), meta(atas.lckd, true), meta(atas.wsol, true),
    meta(poolLckd, true), meta(poolWsol, true), meta(protocolRecipient),
    meta(getAssociatedTokenAddressSync(NATIVE_MINT, protocolRecipient, true), true),
    meta(TOKEN_2022_PROGRAM_ID), meta(TOKEN_PROGRAM_ID), meta(SystemProgram.programId),
    meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(PUMP_AMM_EVENT_AUTHORITY_PDA), meta(PUMP_AMM_PROGRAM_ID),
    meta(getAssociatedTokenAddressSync(NATIVE_MINT, creatorAuthority, true), true), meta(creatorAuthority),
    meta(GLOBAL_VOLUME_ACCUMULATOR_PDA), meta(userVolumeAccumulatorPda(authority), true),
    meta(PUMP_AMM_FEE_CONFIG_PDA), meta(PUMP_FEE_PROGRAM_ID), meta(poolV2Pda(LCKD_MINT)),
    meta(buybackRecipient), meta(getAssociatedTokenAddressSync(NATIVE_MINT, buybackRecipient, true), true),
  ];
  const data = Buffer.alloc(25);
  Buffer.from([198, 46, 21, 82, 180, 217, 232, 112]).copy(data);
  data.writeBigUInt64LE(BigInt(BUYBACK_BURN_LAMPORTS), 8);
  data.writeBigUInt64LE(MINIMUM_OUTPUT, 16);
  return new TransactionInstruction({ programId: PUMP_AMM_PROGRAM_ID, keys, data });
}

function transactionAccountKeys(instruction: TransactionInstruction) {
  const accounts = new Map<string, { pubkey: PublicKey; signer: boolean; writable: boolean }>();
  accounts.set(launcher.toBase58(), { pubkey: launcher, signer: true, writable: true });
  accounts.set(instruction.programId.toBase58(), {
    pubkey: instruction.programId,
    signer: false,
    writable: false,
  });
  instruction.keys.forEach((account) => {
    const encoded = account.pubkey.toBase58();
    const current = accounts.get(encoded);
    accounts.set(encoded, {
      pubkey: account.pubkey,
      signer: Boolean(current?.signer || account.isSigner),
      writable: Boolean(current?.writable || account.isWritable),
    });
  });
  return [...accounts.values()];
}

function raw(instruction: TransactionInstruction) {
  return {
    programId: instruction.programId,
    accounts: instruction.keys.map((account) => account.pubkey),
    data: bs58.encode(instruction.data),
  };
}

function parsed(programId: PublicKey, type: string, info: Record<string, unknown>) {
  return { programId, parsed: { type, info } };
}

function balance(accountIndex: number, mint: PublicKey, amount: string) {
  return {
    accountIndex,
    mint: mint.toBase58(),
    owner: authority.toBase58(),
    uiTokenAmount: { amount },
  };
}

function meta(pubkey: PublicKey, isWritable = false) {
  return { pubkey, isSigner: pubkey.equals(authority), isWritable };
}

function key(seed: number): PublicKey {
  return new PublicKey(Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 256));
}
