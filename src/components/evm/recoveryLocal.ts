import type { Address, Hash, Hex } from "viem";

const LOCAL_PENDING_PREFIX = "lckd_robinhood_pending:";

export interface LocalPendingLaunch {
  kind: "candidate";
  walletAddress: Address;
  salt: Hex;
  transactionHash: Hash;
}

export interface LocalAmbiguousLaunch {
  kind: "ambiguous";
  walletAddress: Address;
  salt: Hex;
}

export type LocalRecoveryMarker = LocalPendingLaunch | LocalAmbiguousLaunch;

export function saveLocalPendingLaunch(record: LocalPendingLaunch) {
  localStorage.setItem(localKey(record.walletAddress), JSON.stringify(record));
}

export function saveLocalAmbiguousLaunch(walletAddress: Address, salt: Hex) {
  const marker: LocalAmbiguousLaunch = { kind: "ambiguous", walletAddress, salt };
  localStorage.setItem(localKey(walletAddress), JSON.stringify(marker));
}

export function loadLocalRecoveryMarker(walletAddress: Address): LocalRecoveryMarker | null {
  try {
    const raw = localStorage.getItem(localKey(walletAddress));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !sameAddress(value.walletAddress, walletAddress)
      || !isHexLength(value.salt, 64) || (value.kind !== "candidate" && value.kind !== "ambiguous")) {
      throw new Error("Invalid local pending launch.");
    }
    if (value.kind === "candidate") {
      if (!isHexLength(value.transactionHash, 64)) throw new Error("Invalid local transaction candidate.");
      return { kind: "candidate", walletAddress, salt: value.salt as Hex, transactionHash: value.transactionHash as Hash };
    }
    return { kind: "ambiguous", walletAddress, salt: value.salt as Hex };
  } catch {
    throw new Error("Local pending launch could not be verified. New wallet requests are blocked.");
  }
}

export function clearLocalPendingLaunch(walletAddress: Address) {
  try {
    localStorage.removeItem(localKey(walletAddress));
  } catch {
    // Terminal server state remains authoritative if browser storage is unavailable.
  }
}

function localKey(walletAddress: Address) {
  return `${LOCAL_PENDING_PREFIX}${walletAddress.toLowerCase()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHexLength(value: unknown, digits: number) {
  return typeof value === "string" && new RegExp(`^0x[0-9a-fA-F]{${digits}}$`).test(value);
}

function sameAddress(value: unknown, expected: Address) {
  return typeof value === "string" && value.toLowerCase() === expected.toLowerCase();
}
