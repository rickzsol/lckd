import { PublicKey } from "@solana/web3.js";

const ANCHOR_EVENT_CPI_DISCRIMINATOR = "e445a52e51cb9a1d";
const PUMP_TRADE_EVENT_DISCRIMINATOR = "bddb7fd34ee661ee";

export interface VerifiedPumpTradeEvent {
  mint: PublicKey;
  user: PublicKey;
  tokenAmount: bigint;
  totalSolAmount: bigint;
}

export function parsePumpTradeEvent(data: Buffer): VerifiedPumpTradeEvent | null {
  if (
    data.subarray(0, 8).toString("hex") !== ANCHOR_EVENT_CPI_DISCRIMINATOR ||
    data.subarray(8, 16).toString("hex") !== PUMP_TRADE_EVENT_DISCRIMINATOR ||
    data.length < 271
  ) {
    return null;
  }
  const mint = new PublicKey(data.subarray(16, 48));
  const solAmount = data.readBigUInt64LE(48);
  const tokenAmount = data.readBigUInt64LE(56);
  if (data[64] !== 1) throw new Error("Pump trade event is not a buy");
  const user = new PublicKey(data.subarray(65, 97));
  const protocolFee = data.readBigUInt64LE(177);
  const creatorFee = data.readBigUInt64LE(225);
  const instructionNameLength = data.readUInt32LE(266);
  const instructionNameEnd = 270 + instructionNameLength;
  if (instructionNameLength > 64 || instructionNameEnd + 33 > data.length) {
    throw new Error("Pump trade event is truncated");
  }
  const instructionName = data.subarray(270, instructionNameEnd).toString("utf8");
  if (!instructionName.startsWith("buy")) throw new Error("Pump trade event name is invalid");
  let cursor = instructionNameEnd + 1;
  cursor += 8;
  const cashback = data.readBigUInt64LE(cursor);
  cursor += 16;
  const buybackFee = data.readBigUInt64LE(cursor);
  return {
    mint,
    user,
    tokenAmount,
    totalSolAmount: solAmount + protocolFee + creatorFee + cashback + buybackFee,
  };
}
