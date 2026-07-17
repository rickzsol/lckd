import assert from "node:assert/strict";
import test from "node:test";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { ICluster } from "@streamflow/stream";
import BN from "bn.js";
import {
  MPL_TOKEN_METADATA_PROGRAM_ID,
  PUMPFUN_PROGRAM_ID,
} from "./constants";
import {
  validatePumpPortalCreateTransaction,
  validateStreamflowLockTransaction,
} from "./transactionValidation";

const CREATE_DISCRIMINATOR = Buffer.from("181ec828051c0777", "hex");
const CREATE_V2_DISCRIMINATOR = Buffer.from("d6904cec5f8b31b4", "hex");
const BUY_DISCRIMINATOR = Buffer.from("66063d1201daebea", "hex");
const MAYHEM_PROGRAM_ID = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");
const PUMP_FEE_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const PUMP_FEE_RECIPIENT = new PublicKey("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV");

function borshString(value: string): Buffer {
  const encoded = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(encoded.length);
  return Buffer.concat([length, encoded]);
}

function u64(value: bigint): Buffer {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64LE(value);
  return encoded;
}

function pda(programId: PublicKey, ...seeds: Uint8Array[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds.map((seed) => Buffer.from(seed)), programId)[0];
}

function legacyCreateKeys(wallet: PublicKey, mint: PublicKey) {
  const bondingCurve = pda(PUMPFUN_PROGRAM_ID, Buffer.from("bonding-curve"), mint.toBuffer());
  return [
    { pubkey: mint, isSigner: true, isWritable: true },
    { pubkey: pda(PUMPFUN_PROGRAM_ID, Buffer.from("mint-authority")), isSigner: false, isWritable: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: getAssociatedTokenAddressSync(mint, bondingCurve, true, TOKEN_PROGRAM_ID), isSigner: false, isWritable: true },
    { pubkey: pda(PUMPFUN_PROGRAM_ID, Buffer.from("global")), isSigner: false, isWritable: false },
    { pubkey: MPL_TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    {
      pubkey: pda(
        MPL_TOKEN_METADATA_PROGRAM_ID,
        Buffer.from("metadata"),
        MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ),
      isSigner: false,
      isWritable: true,
    },
    { pubkey: wallet, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: pda(PUMPFUN_PROGRAM_ID, Buffer.from("__event_authority")), isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
}

function v2CreateKeys(wallet: PublicKey, mint: PublicKey) {
  const bondingCurve = pda(PUMPFUN_PROGRAM_ID, Buffer.from("bonding-curve"), mint.toBuffer());
  const solVault = pda(MAYHEM_PROGRAM_ID, Buffer.from("sol-vault"));
  return [
    { pubkey: mint, isSigner: true, isWritable: true },
    { pubkey: pda(PUMPFUN_PROGRAM_ID, Buffer.from("mint-authority")), isSigner: false, isWritable: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: getAssociatedTokenAddressSync(mint, bondingCurve, true, TOKEN_2022_PROGRAM_ID), isSigner: false, isWritable: true },
    { pubkey: pda(PUMPFUN_PROGRAM_ID, Buffer.from("global")), isSigner: false, isWritable: false },
    { pubkey: wallet, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MAYHEM_PROGRAM_ID, isSigner: false, isWritable: true },
    { pubkey: pda(MAYHEM_PROGRAM_ID, Buffer.from("global-params")), isSigner: false, isWritable: false },
    { pubkey: solVault, isSigner: false, isWritable: true },
    { pubkey: pda(MAYHEM_PROGRAM_ID, Buffer.from("mayhem-state"), mint.toBuffer()), isSigner: false, isWritable: true },
    { pubkey: getAssociatedTokenAddressSync(mint, solVault, true, TOKEN_2022_PROGRAM_ID), isSigner: false, isWritable: true },
    { pubkey: pda(PUMPFUN_PROGRAM_ID, Buffer.from("__event_authority")), isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
}

function legacyBuyKeys(wallet: PublicKey, mint: PublicKey, tokenProgram: PublicKey) {
  const bondingCurve = pda(PUMPFUN_PROGRAM_ID, Buffer.from("bonding-curve"), mint.toBuffer());
  const feeRecipient = PUMP_FEE_RECIPIENT;
  return [
    { pubkey: pda(PUMPFUN_PROGRAM_ID, Buffer.from("global")), isSigner: false, isWritable: false },
    { pubkey: feeRecipient, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: getAssociatedTokenAddressSync(mint, bondingCurve, true, tokenProgram), isSigner: false, isWritable: true },
    { pubkey: getAssociatedTokenAddressSync(mint, wallet, false, tokenProgram), isSigner: false, isWritable: true },
    { pubkey: wallet, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: pda(PUMPFUN_PROGRAM_ID, Buffer.from("creator-vault"), wallet.toBuffer()), isSigner: false, isWritable: true },
    { pubkey: pda(PUMPFUN_PROGRAM_ID, Buffer.from("__event_authority")), isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: pda(PUMPFUN_PROGRAM_ID, Buffer.from("global_volume_accumulator")), isSigner: false, isWritable: false },
    { pubkey: pda(PUMPFUN_PROGRAM_ID, Buffer.from("user_volume_accumulator"), wallet.toBuffer()), isSigner: false, isWritable: true },
    { pubkey: pda(PUMP_FEE_PROGRAM_ID, Buffer.from("fee_config"), PUMPFUN_PROGRAM_ID.toBuffer()), isSigner: false, isWritable: false },
    { pubkey: PUMP_FEE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
}

function buildPortalTransaction(
  maxSolCost = BigInt(1_100_000_000),
  extra?: (wallet: Keypair) => TransactionInstruction,
) {
  const wallet = Keypair.generate();
  const mint = Keypair.generate();
  const metadata = {
    name: "Validation token",
    symbol: "VALID",
    metadataUri: "https://example.com/metadata.json",
    buyAmountSol: 1,
    slippagePercent: 10,
    priorityFeeSol: 0.001,
  };
  const createKeys = legacyCreateKeys(wallet.publicKey, mint.publicKey);
  const buyKeys = legacyBuyKeys(wallet.publicKey, mint.publicKey, TOKEN_PROGRAM_ID);

  const create = new TransactionInstruction({
    programId: PUMPFUN_PROGRAM_ID,
    keys: createKeys,
    data: Buffer.concat([
      CREATE_DISCRIMINATOR,
      borshString(metadata.name),
      borshString(metadata.symbol),
      borshString(metadata.metadataUri),
      wallet.publicKey.toBuffer(),
    ]),
  });
  const buy = new TransactionInstruction({
    programId: PUMPFUN_PROGRAM_ID,
    keys: buyKeys,
    data: Buffer.concat([
      BUY_DISCRIMINATOR,
      u64(BigInt(1)),
      u64(maxSolCost),
      Buffer.from([0]),
    ]),
  });
  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: extra ? [create, buy, extra(wallet)] : [create, buy],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([wallet, mint]);
  return { bytes: transaction.serialize(), wallet, mint, metadata };
}

function buildPortalV2Transaction(isMayhemMode = 0, isCashbackEnabled = 0) {
  const wallet = Keypair.generate();
  const mint = Keypair.generate();
  const metadata = {
    name: "Validation token",
    symbol: "VALID",
    metadataUri: "https://example.com/metadata.json",
    buyAmountSol: 1,
    slippagePercent: 10,
    priorityFeeSol: 0.001,
  };
  const buyKeys = legacyBuyKeys(wallet.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID);
  const create = new TransactionInstruction({
    programId: PUMPFUN_PROGRAM_ID,
    keys: v2CreateKeys(wallet.publicKey, mint.publicKey),
    data: Buffer.concat([
      CREATE_V2_DISCRIMINATOR,
      borshString(metadata.name),
      borshString(metadata.symbol),
      borshString(metadata.metadataUri),
      wallet.publicKey.toBuffer(),
      Buffer.from([isMayhemMode, isCashbackEnabled]),
    ]),
  });
  const buy = new TransactionInstruction({
    programId: PUMPFUN_PROGRAM_ID,
    keys: buyKeys,
    data: Buffer.concat([
      BUY_DISCRIMINATOR,
      u64(BigInt(1)),
      u64(BigInt(1_100_000_000)),
      Buffer.from([0]),
    ]),
  });
  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [create, buy],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([wallet, mint]);
  return { bytes: transaction.serialize(), wallet, mint, metadata };
}

test("accepts one exact pump create and bounded buy", () => {
  const fixture = buildPortalTransaction();
  assert.doesNotThrow(() =>
    validatePumpPortalCreateTransaction(
      fixture.bytes,
      fixture.wallet.publicKey,
      fixture.mint.publicKey,
      fixture.metadata,
    ),
  );
});

test("accepts exact pump create_v2 with mayhem and cashback disabled", () => {
  const fixture = buildPortalV2Transaction();
  assert.doesNotThrow(() =>
    validatePumpPortalCreateTransaction(
      fixture.bytes,
      fixture.wallet.publicKey,
      fixture.mint.publicKey,
      fixture.metadata,
    ),
  );
});

test("rejects pump create_v2 mayhem mode", () => {
  const fixture = buildPortalV2Transaction(1, 0);
  assert.throws(
    () => validatePumpPortalCreateTransaction(
      fixture.bytes,
      fixture.wallet.publicKey,
      fixture.mint.publicKey,
      fixture.metadata,
    ),
    /mayhem and cashback must be disabled/,
  );
});

test("rejects pump create_v2 cashback", () => {
  const fixture = buildPortalV2Transaction(0, 1);
  assert.throws(
    () => validatePumpPortalCreateTransaction(
      fixture.bytes,
      fixture.wallet.publicKey,
      fixture.mint.publicKey,
      fixture.metadata,
    ),
    /mayhem and cashback must be disabled/,
  );
});

test("rejects an added SOL transfer", () => {
  const fixture = buildPortalTransaction(BigInt(1_100_000_000), (wallet) =>
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  );
  assert.throws(
    () => validatePumpPortalCreateTransaction(
      fixture.bytes,
      fixture.wallet.publicKey,
      fixture.mint.publicKey,
      fixture.metadata,
    ),
    /unapproved program/,
  );
});

test("rejects a buy spend limit above the reviewed amount", () => {
  const fixture = buildPortalTransaction(BigInt(2_000_000_000));
  assert.throws(
    () => validatePumpPortalCreateTransaction(
      fixture.bytes,
      fixture.wallet.publicKey,
      fixture.mint.publicKey,
      fixture.metadata,
    ),
    /spend limit is excessive/,
  );
});

test("rejects a compute price whose total priority fee exceeds the review", () => {
  const fixture = buildPortalTransaction(BigInt(1_100_000_000), () =>
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }),
  );
  assert.throws(
    () => validatePumpPortalCreateTransaction(
      fixture.bytes,
      fixture.wallet.publicKey,
      fixture.mint.publicKey,
      fixture.metadata,
    ),
    /priority fee is excessive/,
  );
});

function buildExactStreamflowLock() {
  const wallet = Keypair.generate();
  const mint = Keypair.generate();
  const metadata = Keypair.generate();
  const streamflowProgram = new PublicKey("strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m");
  const treasury = new PublicKey("5SEpbdjFK5FxwTvfsGMXVQTD2v4M2c5tyRTxhdsPkgDw");
  const withdrawor = new PublicKey("wdrwhnCv4pzW8beKsbPa4S2UDZrXenjg16KJdKSpb5u");
  const feeOracle = new PublicKey("B743wFVk2pCYhV91cn287e1xY7f1vt4gdY48hhNiuQmT");
  const walletAta = getAssociatedTokenAddressSync(
    mint.publicKey,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
  const treasuryAta = getAssociatedTokenAddressSync(
    mint.publicKey,
    treasury,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
  const [escrow] = PublicKey.findProgramAddressSync(
    [Buffer.from("strm"), metadata.publicKey.toBuffer()],
    streamflowProgram,
  );
  const amount = new BN("998103");
  const unlockTimestamp = 1_900_000_000;
  const data = Buffer.alloc(148);
  Buffer.from("181ec828051c0777", "hex").copy(data, 0);
  data.writeBigUInt64LE(BigInt(unlockTimestamp), 8);
  data.writeBigUInt64LE(BigInt(amount.toString()), 16);
  data.writeBigUInt64LE(BigInt(1), 24);
  data.writeBigUInt64LE(BigInt(1), 32);
  data.writeBigUInt64LE(BigInt(unlockTimestamp), 40);
  data.writeBigUInt64LE(BigInt(amount.toString()), 48);
  data.writeBigUInt64LE(BigInt(1), 126);
  data[134] = 1;
  data[136] = 1;
  const lockInstruction = new TransactionInstruction({
    programId: streamflowProgram,
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: walletAta, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: false, isWritable: true },
      { pubkey: metadata.publicKey, isSigner: true, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: walletAta, isSigner: false, isWritable: true },
      { pubkey: treasury, isSigner: false, isWritable: true },
      { pubkey: treasuryAta, isSigner: false, isWritable: true },
      { pubkey: withdrawor, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: false, isWritable: true },
      { pubkey: walletAta, isSigner: false, isWritable: true },
      { pubkey: mint.publicKey, isSigner: false, isWritable: false },
      { pubkey: feeOracle, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: streamflowProgram, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const transaction = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    lockInstruction,
  );
  transaction.feePayer = wallet.publicKey;
  transaction.recentBlockhash = Keypair.generate().publicKey.toBase58();
  return { transaction, wallet, mint, metadata, amount, unlockTimestamp };
}

test("accepts only the exact immutable Streamflow v13 lock", () => {
  const fixture = buildExactStreamflowLock();
  assert.doesNotThrow(() =>
    validateStreamflowLockTransaction(
      fixture.transaction,
      fixture.wallet.publicKey,
      fixture.mint.publicKey,
      fixture.metadata.publicKey,
      ICluster.Mainnet,
      TOKEN_2022_PROGRAM_ID,
      fixture.amount,
      fixture.unlockTimestamp,
    ),
  );
});

test("rejects a changed Streamflow account", () => {
  const fixture = buildExactStreamflowLock();
  fixture.transaction.instructions[2].keys[6].pubkey = Keypair.generate().publicKey;
  assert.throws(
    () =>
      validateStreamflowLockTransaction(
        fixture.transaction,
        fixture.wallet.publicKey,
        fixture.mint.publicKey,
        fixture.metadata.publicKey,
        ICluster.Mainnet,
        TOKEN_2022_PROGRAM_ID,
        fixture.amount,
        fixture.unlockTimestamp,
      ),
    /account layout/,
  );
});
