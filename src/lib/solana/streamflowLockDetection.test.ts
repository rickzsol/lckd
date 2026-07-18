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

interface FixtureOptions {
  amountPerPeriod?: bigint;
  cliffRemainder?: bigint;
  extraAccounts?: PublicKey[];
  padding?: number;
  partner?: PublicKey;
  version?: "create" | "create_v2";
}

function fixture(tokenProgram = TOKEN_PROGRAM_ID, options: FixtureOptions = {}) {
  const wallet = Keypair.generate();
  const mint = Keypair.generate();
  const version = options.version ?? "create";
  const nonce = 42;
  const metadataKeypair = Keypair.generate();
  const nonceBuffer = Buffer.alloc(4);
  nonceBuffer.writeUInt32BE(nonce);
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("strm-met"), mint.publicKey.toBuffer(), wallet.publicKey.toBuffer(), nonceBuffer],
    STREAMFLOW_PROGRAM_ID,
  );
  const metadata = { publicKey: version === "create_v2" ? metadataPda : metadataKeypair.publicKey };
  const walletAta = getAssociatedTokenAddressSync(mint.publicKey, wallet.publicKey, false, tokenProgram);
  const treasuryAta = getAssociatedTokenAddressSync(mint.publicKey, TREASURY, false, tokenProgram);
  const partner = options.partner ?? wallet.publicKey;
  const partnerAta = getAssociatedTokenAddressSync(mint.publicKey, partner, false, tokenProgram);
  const [escrow] = PublicKey.findProgramAddressSync(
    [Buffer.from("strm"), metadata.publicKey.toBuffer()],
    STREAMFLOW_PROGRAM_ID,
  );
  const amount = BigInt(900_000);
  const unlockTimestamp = BigInt(1_900_000_000);
  const baseLength = version === "create_v2" ? 140 : 138;
  const data = Buffer.alloc(baseLength + (options.padding ?? 10));
  Buffer.from(version === "create_v2" ? "d6904cec5f8b31b4" : "181ec828051c0777", "hex").copy(data);
  data.writeBigUInt64LE(unlockTimestamp, 8);
  data.writeBigUInt64LE(amount, 16);
  data.writeBigUInt64LE(BigInt(1), 24);
  data.writeBigUInt64LE(options.amountPerPeriod ?? BigInt(1), 32);
  data.writeBigUInt64LE(unlockTimestamp, 40);
  data.writeBigUInt64LE(amount - (options.cliffRemainder ?? BigInt(0)), 48);
  data.writeBigUInt64LE(BigInt(1), 126);
  if (version === "create_v2") {
    data.writeUInt32LE(nonce, 136);
  } else {
    data[134] = 1;
    data[136] = 1;
  }
  const accounts = [
    wallet.publicKey, walletAta, wallet.publicKey, metadata.publicKey, escrow, walletAta,
    TREASURY, treasuryAta, WITHDRAWOR, partner, partnerAta, mint.publicKey,
    FEE_ORACLE, SYSVAR_RENT_PUBKEY, STREAMFLOW_PROGRAM_ID, tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID, SystemProgram.programId,
    ...(options.extraAccounts ?? []),
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
          { pubkey: metadata.publicKey.toBase58(), signer: version === "create" },
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

test("detects create_v2 locks with PDA metadata", () => {
  const lock = fixture(TOKEN_2022_PROGRAM_ID, { version: "create_v2" });
  assert.equal(
    detectStreamflowLock(
      lock.value,
      lock.wallet.publicKey.toBase58(),
      lock.mint.publicKey.toBase58(),
    )?.amountRaw,
    "900000",
  );
});

test("detects Streamflow's one-base-unit cliff remainder lock", () => {
  const lock = fixture(TOKEN_2022_PROGRAM_ID, { cliffRemainder: BigInt(1) });
  assert.equal(
    detectStreamflowLock(
      lock.value,
      lock.wallet.publicKey.toBase58(),
      lock.mint.publicKey.toBase58(),
    )?.amountRaw,
    "900000",
  );
});

test("detects the current Streamflow Token Lock amount-per-period variant", () => {
  const amount = BigInt(900_000);
  const lock = fixture(TOKEN_2022_PROGRAM_ID, {
    amountPerPeriod: amount,
    cliffRemainder: BigInt(1),
  });
  assert.equal(
    detectStreamflowLock(
      lock.value,
      lock.wallet.publicKey.toBase58(),
      lock.mint.publicKey.toBase58(),
    )?.amountRaw,
    amount.toString(),
  );
});

test("detects the production LCKD Streamflow lock transaction", (context) => {
  context.mock.method(Date, "now", () => Date.parse("2026-07-17T22:14:14.000Z"));
  const wallet = "3XyvG1HC1QvzHmNFejUzGgbj8YCLqDRKcoyrWZPuR7p8";
  const mint = "7UTubJ3W6JWwLUj82B9LgHFDmc8wFWtSNLis6u8epump";
  const metadata = "7vnkxKuznBFrbxKSuni2W1JgL9WeMoQ22JMqsN7TU57G";
  const value = {
    meta: {
      err: null,
      preTokenBalances: [{
        mint,
        owner: wallet,
        uiTokenAmount: { amount: "10233075822597", decimals: 6 },
      }],
      postTokenBalances: [{
        mint,
        owner: wallet,
        uiTokenAmount: { amount: "1", decimals: 6 },
      }],
    },
    transaction: {
      message: {
        accountKeys: [
          { pubkey: wallet, signer: true },
          { pubkey: metadata, signer: true },
        ],
        instructions: [{
          accounts: [
            wallet,
            "Gabha1XUCohDs9DNTbptYbYRuTKf53rxGqxXSG9suR4y",
            wallet,
            metadata,
            "97wojc5USr7ZTBD1gkB2Ln5MXxwpm966DfbLMfhQx2BS",
            "Gabha1XUCohDs9DNTbptYbYRuTKf53rxGqxXSG9suR4y",
            TREASURY.toBase58(),
            "HcsLEoAc8Ly33DVUiZocMbE4jnAqs8uLQyXbyunu19TG",
            WITHDRAWOR.toBase58(),
            "4iMUh4tr56jhmJu2K5hz1weezwAnZCY43Hs8S6iwV8FE",
            "662f8Rd9Lq8j5AzoJAU1v3zo88k7n5ys9qeNP8XLZMTy",
            mint,
            FEE_ORACLE.toBase58(),
            SYSVAR_RENT_PUBKEY.toBase58(),
            STREAMFLOW_PROGRAM_ID.toBase58(),
            TOKEN_2022_PROGRAM_ID.toBase58(),
            ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
            SystemProgram.programId.toBase58(),
          ],
          data: "9oaEZg3FZatp3iTZnwJGVwxtXLePBfc7xW9XyB4q7QhV4aCdPcv9EZtWTz7UuwTbebNf5VNdF42KKg62bcqY4wXFfXXT8XD6XPBotbVR2g1chBa7tnV9Ltpfx46ezjMUkDykzxs8ks1zkXkXeCg2XxfD9kAYGtxq4QwgKNLpY999Xk95RAEmDs7iXJYMC12DGrdwEqdpAT",
          programId: STREAMFLOW_PROGRAM_ID.toBase58(),
        }],
      },
    },
  };

  assert.deepEqual(detectStreamflowLock(value, wallet, mint), {
    amountRaw: "10182164997608",
    decimals: 6,
    lockedPercentage: 99.5,
    metadataId: metadata,
    unlockAt: "2026-07-27T06:00:00.000Z",
  });
});

test("accepts current optional padding, partner, and remaining accounts", () => {
  const lock = fixture(TOKEN_2022_PROGRAM_ID, {
    extraAccounts: [Keypair.generate().publicKey],
    padding: 0,
    partner: Keypair.generate().publicKey,
  });
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

test("rejects create_v2 with a nonce that does not match its metadata PDA", () => {
  const lock = fixture(TOKEN_2022_PROGRAM_ID, { version: "create_v2" });
  lock.data.writeUInt32LE(43, 136);
  lock.value.transaction.message.instructions[0].data = bs58.encode(lock.data);
  assert.equal(
    detectStreamflowLock(lock.value, lock.wallet.publicKey.toBase58(), lock.mint.publicKey.toBase58()),
    null,
  );
});

test("rejects nonzero Streamflow padding", () => {
  const lock = fixture();
  lock.data[lock.data.length - 1] = 1;
  lock.value.transaction.message.instructions[0].data = bs58.encode(lock.data);
  assert.equal(
    detectStreamflowLock(lock.value, lock.wallet.publicKey.toBase58(), lock.mint.publicKey.toBase58()),
    null,
  );
});

test("rejects an invalid partner token account", () => {
  const lock = fixture(TOKEN_2022_PROGRAM_ID, { partner: Keypair.generate().publicKey });
  lock.accounts[10] = Keypair.generate().publicKey.toBase58();
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
