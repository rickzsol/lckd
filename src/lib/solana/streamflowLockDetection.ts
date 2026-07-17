import bs58 from "bs58";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from "@solana/web3.js";
import { PUMPFUN_TOKEN_DECIMALS, STREAMFLOW_PROGRAM_ID } from "./constants";

const CREATE_DISCRIMINATOR = "181ec828051c0777";
const STREAMFLOW_TREASURY = new PublicKey("5SEpbdjFK5FxwTvfsGMXVQTD2v4M2c5tyRTxhdsPkgDw");
const STREAMFLOW_WITHDRAWOR = new PublicKey("wdrwhnCv4pzW8beKsbPa4S2UDZrXenjg16KJdKSpb5u");
const STREAMFLOW_FEE_ORACLE = new PublicKey("B743wFVk2pCYhV91cn287e1xY7f1vt4gdY48hhNiuQmT");

export interface DetectedStreamflowLock {
  amountRaw: string;
  decimals: number;
  lockedPercentage: number | null;
  metadataId: string;
  unlockAt: string;
}

function accountKey(value: unknown): { pubkey: string; signer: boolean } | null {
  if (!value || typeof value !== "object") return null;
  const pubkey = Reflect.get(value, "pubkey");
  const signer = Reflect.get(value, "signer");
  return typeof pubkey === "string" && typeof signer === "boolean" ? { pubkey, signer } : null;
}

function tokenBalance(
  values: unknown,
  walletAddress: string,
  mintAddress: string,
): { amount: bigint; decimals: number } | null {
  if (!Array.isArray(values)) return null;
  let amount = BigInt(0);
  let decimals: number | null = null;
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    if (Reflect.get(value, "owner") !== walletAddress || Reflect.get(value, "mint") !== mintAddress) continue;
    const tokenAmount = Reflect.get(value, "uiTokenAmount");
    if (!tokenAmount || typeof tokenAmount !== "object") continue;
    const raw = Reflect.get(tokenAmount, "amount");
    const nextDecimals = Reflect.get(tokenAmount, "decimals");
    if (typeof raw !== "string" || !/^\d+$/.test(raw) || !Number.isInteger(nextDecimals)) continue;
    amount += BigInt(raw);
    decimals = Number(nextDecimals);
  }
  return decimals === null ? null : { amount, decimals };
}

function parseLockData(data: Buffer): { amount: bigint; unlockTimestamp: bigint } | null {
  if (data.length !== 148 || data.subarray(0, 8).toString("hex") !== CREATE_DISCRIMINATOR) return null;
  const start = data.readBigUInt64LE(8);
  const amount = data.readBigUInt64LE(16);
  const period = data.readBigUInt64LE(24);
  const amountPerPeriod = data.readBigUInt64LE(32);
  const cliff = data.readBigUInt64LE(40);
  const cliffAmount = data.readBigUInt64LE(48);
  const withdrawalFrequency = data.readBigUInt64LE(126);
  const hasDisabledPermissions = [56, 57, 58, 59, 60, 61].every(
    (offset) => data[offset] === 0,
  );
  const hasImmutableOptions = data[134] === 1 && data[135] === 0 &&
    data[136] === 1 && data[137] === 0 && data.subarray(138).every((byte) => byte === 0);
  if (
    amount < BigInt(1) ||
    start !== cliff ||
    period !== BigInt(1) ||
    amountPerPeriod !== BigInt(1) ||
    cliffAmount !== amount ||
    withdrawalFrequency !== period ||
    !hasDisabledPermissions ||
    !hasImmutableOptions
  ) return null;
  return { amount, unlockTimestamp: cliff };
}

export function detectStreamflowLock(
  value: unknown,
  walletAddress: string,
  mintAddress: string,
): DetectedStreamflowLock | null {
  if (!value || typeof value !== "object") return null;
  const meta = Reflect.get(value, "meta");
  const transaction = Reflect.get(value, "transaction");
  if (!meta || typeof meta !== "object" || Reflect.get(meta, "err") != null ||
    !transaction || typeof transaction !== "object") return null;
  const message = Reflect.get(transaction, "message");
  if (!message || typeof message !== "object") return null;
  const rawKeys = Reflect.get(message, "accountKeys");
  const rawInstructions = Reflect.get(message, "instructions");
  if (!Array.isArray(rawKeys) || !Array.isArray(rawInstructions)) return null;
  const keys = rawKeys.map(accountKey);
  if (!keys[0]?.signer || keys[0].pubkey !== walletAddress) return null;

  const wallet = new PublicKey(walletAddress);
  const mint = new PublicKey(mintAddress);
  for (const rawInstruction of rawInstructions) {
    if (!rawInstruction || typeof rawInstruction !== "object") continue;
    if (Reflect.get(rawInstruction, "programId") !== STREAMFLOW_PROGRAM_ID.toBase58()) continue;
    const accounts = Reflect.get(rawInstruction, "accounts");
    const encodedData = Reflect.get(rawInstruction, "data");
    if (!Array.isArray(accounts) || !accounts.every((account) => typeof account === "string") ||
      typeof encodedData !== "string") continue;
    try {
      const metadata = new PublicKey(accounts[3]);
      const tokenProgram = new PublicKey(accounts[15]);
      if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) continue;
      const walletAta = getAssociatedTokenAddressSync(mint, wallet, false, tokenProgram);
      const treasuryAta = getAssociatedTokenAddressSync(mint, STREAMFLOW_TREASURY, false, tokenProgram);
      const [escrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("strm"), metadata.toBuffer()],
        STREAMFLOW_PROGRAM_ID,
      );
      const expected = [
        wallet, walletAta, wallet, metadata, escrow, walletAta, STREAMFLOW_TREASURY,
        treasuryAta, STREAMFLOW_WITHDRAWOR, wallet, walletAta, mint,
        STREAMFLOW_FEE_ORACLE, SYSVAR_RENT_PUBKEY, STREAMFLOW_PROGRAM_ID,
        tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID, SystemProgram.programId,
      ].map((account) => account.toBase58());
      if (accounts.length !== expected.length || accounts.some((account, index) => account !== expected[index])) continue;
      if (!keys.find((key) => key?.pubkey === metadata.toBase58())?.signer) continue;
      const lock = parseLockData(Buffer.from(bs58.decode(encodedData)));
      if (!lock || lock.unlockTimestamp <= BigInt(Math.floor(Date.now() / 1_000) - 60)) continue;

      const pre = tokenBalance(Reflect.get(meta, "preTokenBalances"), walletAddress, mintAddress);
      const post = tokenBalance(Reflect.get(meta, "postTokenBalances"), walletAddress, mintAddress);
      const debit = pre && post ? pre.amount - post.amount : null;
      if (debit !== null && (debit <= BigInt(0) || lock.amount > debit)) continue;
      const lockedPercentage = pre && pre.amount > BigInt(0)
        ? Number((lock.amount * BigInt(10_000)) / pre.amount) / 100
        : null;
      return {
        amountRaw: lock.amount.toString(),
        decimals: pre?.decimals ?? PUMPFUN_TOKEN_DECIMALS,
        lockedPercentage,
        metadataId: metadata.toBase58(),
        unlockAt: new Date(Number(lock.unlockTimestamp) * 1_000).toISOString(),
      };
    } catch {
      continue;
    }
  }
  return null;
}
