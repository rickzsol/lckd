import assert from "node:assert/strict";
import test from "node:test";
import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  OFFLINE_PUMP_AMM_PROGRAM,
  PUMP_AMM_PROGRAM_ID,
  PUMP_AMM_SDK,
  pumpPoolAuthorityPda,
  type SwapSolanaState,
} from "@pump-fun/pump-swap-sdk";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import {
  BUYBACK_BURN_LAMPORTS,
  LCKD_CANONICAL_PUMP_POOL,
  LCKD_MINT,
  PUMP_BUYBACK_FEE_RECIPIENT,
  PUMP_PROTOCOL_FEE_RECIPIENT,
  assertBuybackBurnSnapshot,
  deriveBuybackBurnAtas,
  deriveBuybackBurnAuthority,
  estimateBuybackBurnInstruction,
  validatePumpBuyExactQuoteInInstruction,
  wrapBuybackBurnInstruction,
} from "./buybackBurn";
import { buildBuybackBurnFromState } from "./buybackBurn.server";

const PROGRAM_ID = key(80);
const LAUNCHER = key(81);
const AUTHORITY = deriveBuybackBurnAuthority(PROGRAM_ID);

test("builds a fixed 0.1 SOL Pump buyExactQuoteIn CPI wrapped by the custom program", () => {
  const built = buildBuybackBurnFromState({
    state: frozenState(),
    observedSlot: 321,
    programId: PROGRAM_ID,
    launcher: LAUNCHER,
    authority: AUTHORITY,
    slippageBps: 100,
  });

  assert.equal(built.pumpInstruction.data.length, 25);
  assert.deepEqual([...built.pumpInstruction.data.subarray(0, 8)], [198, 46, 21, 82, 180, 217, 232, 112]);
  assert.equal(built.pumpInstruction.data.readBigUInt64LE(8), BigInt(100_000_000));
  assert.equal(built.pumpInstruction.data.readBigUInt64LE(16), BigInt(built.snapshot.minimumBaseAmountOut));
  assert.equal(built.pumpInstruction.data[24], 0, "trackVolume=false encodes as one zero byte");
  assert.equal(built.pumpInstruction.keys.length, 26);
  assert.equal(built.pumpInstruction.keys[1].isSigner, true);

  assert.equal(built.instruction.programId.toBase58(), PROGRAM_ID.toBase58());
  assert.equal(built.instruction.keys.length, 27);
  assert.deepEqual(built.instruction.keys[0], {
    pubkey: LAUNCHER,
    isSigner: true,
    isWritable: true,
  });
  assert.equal(built.instruction.keys[2].pubkey.toBase58(), AUTHORITY.toBase58());
  assert.equal(built.instruction.keys[2].isSigner, false, "the program supplies PDA signer privilege");
  assert.deepEqual([...built.instruction.data], [0, ...u64(built.snapshot.minimumBaseAmountOut)]);
  assertBuybackBurnSnapshot(built.snapshot);
});

test("matches Pump SDK v1.19 Anchor encoding and account order", async () => {
  const state = frozenState();
  const built = buildBuybackBurnFromState({ ...buildParams(), state });
  const minimum = new BN(built.snapshot.minimumBaseAmountOut);
  const encoded = OFFLINE_PUMP_AMM_PROGRAM.coder.instruction.encode("buyExactQuoteIn", {
    spendableQuoteIn: new BN(BUYBACK_BURN_LAMPORTS),
    minBaseAmountOut: minimum,
    trackVolume: { 0: false },
  });
  assert.deepEqual(built.pumpInstruction.data, encoded);

  const sdkInstructions = await PUMP_AMM_SDK.buyInstructionsNoPool(
    state,
    new BN(1),
    new BN(BUYBACK_BURN_LAMPORTS),
  );
  const sdkBuy = sdkInstructions.find(
    (instruction) => instruction.programId.equals(PUMP_AMM_PROGRAM_ID) && instruction.data.length > 8,
  );
  assert.ok(sdkBuy);
  assert.deepEqual(
    built.pumpInstruction.keys.map(stringifyMeta),
    sdkBuy.keys.map(stringifyMeta),
  );
});

test("derives the PDA and authority ATAs deterministically", () => {
  const authority = deriveBuybackBurnAuthority(PROGRAM_ID);
  const atas = deriveBuybackBurnAtas(authority);
  assert.equal(authority.toBase58(), AUTHORITY.toBase58());
  assert.equal(
    atas.lckd.toBase58(),
    getAssociatedTokenAddressSync(LCKD_MINT, authority, true, TOKEN_2022_PROGRAM_ID).toBase58(),
  );
  assert.equal(atas.wsol.toBase58(), getAssociatedTokenAddressSync(NATIVE_MINT, authority, true).toBase58());
});

test("rejects a non-canonical authority, mint, ATA, token program, or slippage", () => {
  const base = buildParams();
  assert.throws(
    () => buildBuybackBurnFromState({ ...base, authority: key(90) }),
    /authority PDA|Pump user/,
  );
  assert.throws(
    () => buildBuybackBurnFromState({ ...base, slippageBps: 501 }),
    /slippage/,
  );

  const wrongMint = frozenState();
  wrongMint.baseMint = key(91);
  assert.throws(() => buildBuybackBurnFromState({ ...base, state: wrongMint }), /base mint/);

  const wrongAta = frozenState();
  wrongAta.userBaseTokenAccount = key(92);
  assert.throws(() => buildBuybackBurnFromState({ ...base, state: wrongAta }), /deterministic ATAs/);

  const wrongProgram = frozenState();
  wrongProgram.quoteTokenProgram = key(93);
  assert.throws(() => buildBuybackBurnFromState({ ...base, state: wrongProgram }), /token programs/);

  const rotatedRecipient = frozenState();
  rotatedRecipient.globalConfig.protocolFeeRecipients = [key(94)];
  assert.throws(
    () => buildBuybackBurnFromState({ ...base, state: rotatedRecipient }),
    /account 9/,
  );
});

test("rejects Pump instruction mutations in program, amount, output, data, and account order", () => {
  const built = buildBuybackBurnFromState(buildParams());
  const minimum = BigInt(built.snapshot.minimumBaseAmountOut);

  const wrongProgram = cloneInstruction(built.pumpInstruction, { programId: key(99) });
  assert.throws(() => validatePumpBuyExactQuoteInInstruction(wrongProgram, AUTHORITY, minimum), /canonical Pump/);

  const wrongAmountData = Buffer.from(built.pumpInstruction.data);
  wrongAmountData.writeBigUInt64LE(BigInt(BUYBACK_BURN_LAMPORTS - 1), 8);
  assert.throws(
    () => validatePumpBuyExactQuoteInInstruction(cloneInstruction(built.pumpInstruction, { data: wrongAmountData }), AUTHORITY, minimum),
    /exactly 0.1 SOL/,
  );

  const wrongOutputData = Buffer.from(built.pumpInstruction.data);
  wrongOutputData.writeBigUInt64LE(minimum - BigInt(1), 16);
  assert.throws(
    () => validatePumpBuyExactQuoteInInstruction(cloneInstruction(built.pumpInstruction, { data: wrongOutputData }), AUTHORITY, minimum),
    /minimum LCKD output/,
  );

  const wrongOrder = [...built.pumpInstruction.keys];
  [wrongOrder[3], wrongOrder[4]] = [wrongOrder[4], wrongOrder[3]];
  assert.throws(
    () => validatePumpBuyExactQuoteInInstruction(cloneInstruction(built.pumpInstruction, { keys: wrongOrder }), AUTHORITY, minimum),
    /account 3/,
  );
});

test("outer wrapper declares every atomic-launch escalated write privilege", () => {
  const built = buildBuybackBurnFromState(buildParams());
  const minimum = BigInt(built.snapshot.minimumBaseAmountOut);
  const wrapped = wrapBuybackBurnInstruction({
    programId: PROGRAM_ID,
    launcher: LAUNCHER,
    authority: AUTHORITY,
    pumpInstruction: built.pumpInstruction,
    minimumBaseAmountOut: minimum,
  });
  built.pumpInstruction.keys.forEach((pumpMeta, index) => {
    const outerMeta = wrapped.keys[index + 1];
    assert.equal(outerMeta.pubkey.toBase58(), pumpMeta.pubkey.toBase58());
    assert.equal(
      outerMeta.isWritable,
      index === 3 || index === 9 || index === 24 ? true : pumpMeta.isWritable,
    );
    assert.equal(outerMeta.isSigner, index === 1 ? false : pumpMeta.isSigner);
  });
});

test("reports the standalone instruction account and legacy-size budget", () => {
  const { instruction } = buildBuybackBurnFromState(buildParams());
  assert.deepEqual(estimateBuybackBurnInstruction(instruction, LAUNCHER), {
    accountMetas: 27,
    uniqueTransactionAccounts: 28,
    instructionDataBytes: 9,
    estimatedLegacyTransactionBytes: 1037,
  });
});

function buildParams() {
  return {
    state: frozenState(),
    observedSlot: 321,
    programId: PROGRAM_ID,
    launcher: LAUNCHER,
    authority: AUTHORITY,
    slippageBps: 100,
  };
}

function frozenState(): SwapSolanaState {
  const authorityAtas = deriveBuybackBurnAtas(AUTHORITY);
  const poolBase = getAssociatedTokenAddressSync(
    LCKD_MINT,
    LCKD_CANONICAL_PUMP_POOL,
    true,
    TOKEN_2022_PROGRAM_ID,
  );
  const poolQuote = getAssociatedTokenAddressSync(NATIVE_MINT, LCKD_CANONICAL_PUMP_POOL, true);
  return {
    poolKey: LCKD_CANONICAL_PUMP_POOL,
    poolAccountInfo: { data: Buffer.alloc(300) } as never,
    pool: {
      poolBump: 1,
      index: 0,
      creator: pumpPoolAuthorityPda(LCKD_MINT),
      baseMint: LCKD_MINT,
      quoteMint: NATIVE_MINT,
      lpMint: key(10),
      poolBaseTokenAccount: poolBase,
      poolQuoteTokenAccount: poolQuote,
      lpSupply: new BN("1000000000"),
      coinCreator: new PublicKey("3XyvG1HC1QvzHmNFejUzGgbj8YCLqDRKcoyrWZPuR7p8"),
      isMayhemMode: false,
      isCashbackCoin: false,
      virtualQuoteReserves: new BN("500000000"),
    },
    poolBaseAmount: new BN("500000000000000"),
    poolQuoteAmount: new BN("250000000000"),
    baseTokenProgram: TOKEN_2022_PROGRAM_ID,
    quoteTokenProgram: TOKEN_PROGRAM_ID,
    baseMint: LCKD_MINT,
    baseMintAccount: { supply: BigInt("1000000000000000") } as never,
    user: AUTHORITY,
    userBaseTokenAccount: authorityAtas.lckd,
    userQuoteTokenAccount: authorityAtas.wsol,
    userBaseAccountInfo: null,
    userQuoteAccountInfo: null,
    feeConfig: null,
    globalConfig: {
      admin: key(20),
      lpFeeBasisPoints: new BN(20),
      protocolFeeBasisPoints: new BN(5),
      disableFlags: 0,
      protocolFeeRecipients: [PUMP_PROTOCOL_FEE_RECIPIENT],
      coinCreatorFeeBasisPoints: new BN(5),
      adminSetCoinCreatorAuthority: key(22),
      whitelistPda: key(23),
      reservedFeeRecipient: key(24),
      mayhemModeEnabled: false,
      reservedFeeRecipients: [],
      buybackFeeRecipients: [PUMP_BUYBACK_FEE_RECIPIENT],
      buybackBasisPoints: new BN(50),
      boostAuthority: key(26),
      boostEnabled: true,
    },
  };
}

function cloneInstruction(
  source: TransactionInstruction,
  patch: Partial<Pick<TransactionInstruction, "programId" | "keys" | "data">>,
) {
  return new TransactionInstruction({
    programId: patch.programId ?? source.programId,
    keys: patch.keys ?? source.keys,
    data: patch.data ?? source.data,
  });
}

function key(seed: number): PublicKey {
  return new PublicKey(Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 256));
}

function u64(value: string): number[] {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return [...buffer];
}

function stringifyMeta(meta: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }) {
  return { pubkey: meta.pubkey.toBase58(), isSigner: meta.isSigner, isWritable: meta.isWritable };
}
