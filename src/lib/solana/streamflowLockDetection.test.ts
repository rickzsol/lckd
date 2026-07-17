import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from "@solana/web3.js";
import { STREAMFLOW_PROGRAM_ID } from "./constants";
import { detectStreamflowLock } from "./streamflowLockDetection";

const TREASURY = new PublicKey("5SEpbdjFK5FxwTvfsGMXVQTD2v4M2c5tyRTxhdsPkgDw");
const WITHDRAWOR = new PublicKey("wdrwhnCv4pzW8beKsbPa4S2UDZrXenjg16KJdKSpb5u");
const FEE_ORACLE = new PublicKey("B743wFVk2pCYhV91cn287e1xY7f1vt4gdY48hhNiuQmT");

function fixture(tokenProgram = TOKEN_PROGRAM_ID) {
  const wallet = Keypair.generate();
  const mint = Keypair.generate();
  const metadata = Keypair.generate();
  const walletAta = getAssociatedTokenAddressSync(mint.publicKey, wallet.publicKey, false, tokenProgram);
  const treasuryAta = getAssociatedTokenAddressSync(mint.publicKey, TREASURY, false, tokenProgram);
  const [escrow] = PublicKey.findProgramAddressSync(
    [Buffer.from("strm"), metadata.publicKey.toBuffer()],
    STREAMFLOW_PROGRAM_ID,
  );
  const amount = BigInt(900_000);
  const unlockTimestamp = BigInt(1_900_000_000);
  const data = Buffer.alloc(148);
  Buffer.from("181ec828051c0777", "hex").copy(data);
  data.writeBigUInt64LE(unlockTimestamp, 8);
  data.writeBigUInt64LE(amount, 16);
  data.writeBigUInt64LE(BigInt(1), 24);
  data.writeBigUInt64LE(BigInt(1), 32);
  data.writeBigUInt64LE(unlockTimestamp, 40);
  data.writeBigUInt64LE(amount, 48);
  data.writeBigUInt64LE(BigInt(1), 126);
  data[134] = 1;
  data[136] = 1;
  const accounts = [
    wallet.publicKey, walletAta, wallet.publicKey, metadata.publicKey, escrow, walletAta,
    TREASURY, treasuryAta, WITHDRAWOR, wallet.publicKey, walletAta, mint.publicKey,
    FEE_ORACLE, SYSVAR_RENT_PUBKEY, STREAMFLOW_PROGRAM_ID, tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID, SystemProgram.programId,
  ].map((key) => key.toBase58());
  const value = {
    meta: {
      err: null,
      preTokenBalances: [{
        mint: mint.publicKey.toBase58(),
        owner: wallet.publicKey.toBase58(),
        uiTokenAmount: { amount: "1000000", decimals: 6 },
      }],
      postTokenBalances: [{
        mint: mint.publicKey.toBase58(),
        owner: wallet.publicKey.toBase58(),
        uiTokenAmount: { amount: "100000", decimals: 6 },
      }],
    },
    transaction: {
      message: {
        accountKeys: [
          { pubkey: wallet.publicKey.toBase58(), signer: true },
          { pubkey: metadata.publicKey.toBase58(), signer: true },
        ],
        instructions: [{
          accounts,
          data: bs58.encode(data),
          programId: STREAMFLOW_PROGRAM_ID.toBase58(),
        }],
      },
    },
  };
  return { accounts, data, metadata, mint, value, wallet };
}

test("detects the exact immutable Streamflow token lock", () => {
  const lock = fixture();
  assert.deepEqual(
    detectStreamflowLock(
      lock.value,
      lock.wallet.publicKey.toBase58(),
      lock.mint.publicKey.toBase58(),
    ),
    {
      amountRaw: "900000",
      decimals: 6,
      lockedPercentage: 90,
      metadataId: lock.metadata.publicKey.toBase58(),
      unlockAt: "2030-03-17T17:46:40.000Z",
    },
  );
});

test("detects the same reviewed lock for a Token-2022 mint", () => {
  const lock = fixture(TOKEN_2022_PROGRAM_ID);
  assert.equal(
    detectStreamflowLock(
      lock.value,
      lock.wallet.publicKey.toBase58(),
      lock.mint.publicKey.toBase58(),
    )?.amountRaw,
    "900000",
  );
});

test("rejects a mutable Streamflow contract", () => {
  const lock = fixture();
  lock.data[56] = 1;
  lock.value.transaction.message.instructions[0].data = bs58.encode(lock.data);
  assert.equal(
    detectStreamflowLock(lock.value, lock.wallet.publicKey.toBase58(), lock.mint.publicKey.toBase58()),
    null,
  );
});

test("rejects a lock with a changed recipient account", () => {
  const lock = fixture();
  lock.accounts[2] = Keypair.generate().publicKey.toBase58();
  assert.equal(
    detectStreamflowLock(lock.value, lock.wallet.publicKey.toBase58(), lock.mint.publicKey.toBase58()),
    null,
  );
});

test("rejects failed transactions and excess claimed lock amounts", () => {
  const failed = fixture();
  (failed.value.meta as { err: unknown }).err = { InstructionError: [0, "Custom"] };
  assert.equal(
    detectStreamflowLock(failed.value, failed.wallet.publicKey.toBase58(), failed.mint.publicKey.toBase58()),
    null,
  );

  const excess = fixture();
  excess.value.meta.postTokenBalances[0].uiTokenAmount.amount = "200000";
  assert.equal(
    detectStreamflowLock(excess.value, excess.wallet.publicKey.toBase58(), excess.mint.publicKey.toBase58()),
    null,
  );
});
