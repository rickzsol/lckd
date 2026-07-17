export const OFFICIAL_DEV_WALLET = "3XyvG1HC1QvzHmNFejUzGgbj8YCLqDRKcoyrWZPuR7p8";

export type OfficialLaunchStatus = "processed" | "confirmed" | "retracted";

export interface OfficialLockEvent {
  amountRaw: string;
  decimals: number;
  detectedAt: string;
  lockedPercentage: number | null;
  metadataId: string;
  signature: string;
  slot: number;
  status: OfficialLaunchStatus;
  unlockAt: string;
}

export interface OfficialLaunchEvent {
  detectedAt: string;
  metadataUri: string;
  mintAddress: string;
  name: string;
  lock: OfficialLockEvent | null;
  signature: string;
  slot: number;
  status: OfficialLaunchStatus;
  symbol: string;
}

export interface OfficialLaunchResponse {
  epoch: string;
  launch: OfficialLaunchEvent | null;
  monitoredWallet: string;
  version: number;
}

export function parseOfficialLaunchResponse(value: unknown): OfficialLaunchResponse | null {
  if (!value || typeof value !== "object") return null;
  const epoch = Reflect.get(value, "epoch");
  const launchValue = Reflect.get(value, "launch");
  const monitoredWallet = Reflect.get(value, "monitoredWallet");
  const version = Reflect.get(value, "version");
  const launch = launchValue === null ? null : parseOfficialLaunchEvent(launchValue);
  if (
    typeof epoch !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(epoch) ||
    (launchValue !== null && !launch) ||
    monitoredWallet !== OFFICIAL_DEV_WALLET ||
    !Number.isSafeInteger(version) ||
    Number(version) < 0
  ) return null;
  return {
    epoch,
    launch,
    monitoredWallet,
    version: Number(version),
  };
}

function parseOfficialLockEvent(value: unknown): OfficialLockEvent | null {
  if (!value || typeof value !== "object") return null;
  const amountRaw = Reflect.get(value, "amountRaw");
  const decimals = Reflect.get(value, "decimals");
  const detectedAt = Reflect.get(value, "detectedAt");
  const lockedPercentage = Reflect.get(value, "lockedPercentage");
  const metadataId = Reflect.get(value, "metadataId");
  const signature = Reflect.get(value, "signature");
  const slot = Reflect.get(value, "slot");
  const status = Reflect.get(value, "status");
  const unlockAt = Reflect.get(value, "unlockAt");
  if (
    typeof amountRaw !== "string" ||
    !/^\d+$/.test(amountRaw) ||
    BigInt(amountRaw) < BigInt(1) ||
    !Number.isInteger(decimals) ||
    Number(decimals) < 0 ||
    Number(decimals) > 18 ||
    typeof detectedAt !== "string" ||
    !Number.isFinite(Date.parse(detectedAt)) ||
    (lockedPercentage !== null &&
      (typeof lockedPercentage !== "number" || lockedPercentage <= 0 || lockedPercentage > 100)) ||
    typeof metadataId !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(metadataId) ||
    typeof signature !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature) ||
    !Number.isSafeInteger(slot) ||
    Number(slot) < 1 ||
    !["processed", "confirmed", "retracted"].includes(String(status)) ||
    typeof unlockAt !== "string" ||
    !Number.isFinite(Date.parse(unlockAt))
  ) return null;
  return {
    amountRaw,
    decimals: Number(decimals),
    detectedAt,
    lockedPercentage,
    metadataId,
    signature,
    slot: Number(slot),
    status: status as OfficialLaunchStatus,
    unlockAt,
  };
}

export function parseOfficialLaunchEvent(value: unknown): OfficialLaunchEvent | null {
  if (!value || typeof value !== "object") return null;
  const status = Reflect.get(value, "status");
  const detectedAt = Reflect.get(value, "detectedAt");
  const metadataUri = Reflect.get(value, "metadataUri");
  const mintAddress = Reflect.get(value, "mintAddress");
  const name = Reflect.get(value, "name");
  const lockValue = Reflect.get(value, "lock");
  const signature = Reflect.get(value, "signature");
  const slot = Reflect.get(value, "slot");
  const symbol = Reflect.get(value, "symbol");
  const lock = lockValue === null ? null : parseOfficialLockEvent(lockValue);
  if (
    !["processed", "confirmed", "retracted"].includes(String(status)) ||
    typeof detectedAt !== "string" ||
    !Number.isFinite(Date.parse(detectedAt)) ||
    typeof metadataUri !== "string" ||
    !(metadataUri.startsWith("https://") || metadataUri.startsWith("ipfs://")) ||
    typeof mintAddress !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mintAddress) ||
    typeof name !== "string" ||
    name.length < 1 ||
    name.length > 32 ||
    typeof signature !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature) ||
    !Number.isSafeInteger(slot) ||
    Number(slot) < 1 ||
    (lockValue !== null && !lock) ||
    typeof symbol !== "string" ||
    symbol.length < 1 ||
    symbol.length > 13
  ) return null;
  return {
    detectedAt,
    metadataUri,
    mintAddress,
    name,
    lock,
    signature,
    slot: Number(slot),
    status: status as OfficialLaunchStatus,
    symbol,
  };
}
