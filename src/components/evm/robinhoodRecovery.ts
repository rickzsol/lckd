import { isAddress, type Address, type Hash, type Hex } from "viem";
import type { RobinhoodLaunchFormData } from "./launchTypes";
import type { LocalRecoveryMarker } from "./recoveryLocal";

const RECOVERY_ENDPOINT = "/api/v1/launch/robinhood/recovery";
const RECOVERY_STATUSES = ["prepared", "submitted", "ambiguous", "verified", "failed"] as const;

export type RecoveryStatus = (typeof RECOVERY_STATUSES)[number];

export interface RobinhoodRecoveryIntent {
  id: string;
  status: RecoveryStatus;
  walletAddress: Address;
  salt: Hex;
  transactionHash: Hash | null;
  config: RobinhoodLaunchFormData;
  tokenAddress: Address | null;
  poolAddress: Address | null;
  positionId: string | null;
  error: string | null;
}

export async function getRobinhoodRecovery(walletAddress: Address) {
  const query = new URLSearchParams({ walletAddress });
  return requestRecovery(`${RECOVERY_ENDPOINT}?${query}`, { cache: "no-store" });
}

export async function prepareRobinhoodRecovery(
  walletAddress: Address,
  salt: Hex,
  config: RobinhoodLaunchFormData,
) {
  return requestRecovery(RECOVERY_ENDPOINT, postBody({
    phase: "prepared",
    walletAddress,
    salt,
    config,
  }));
}

export async function submitRobinhoodRecovery(
  walletAddress: Address,
  salt: Hex,
  transactionHash: Hash,
) {
  return requestRecovery(RECOVERY_ENDPOINT, postBody({
    phase: "submitted",
    walletAddress,
    salt,
    transactionHash,
  }));
}

export async function reconcileRobinhoodRecovery(walletAddress: Address, salt: Hex) {
  return requestRecovery(RECOVERY_ENDPOINT, postBody({
    phase: "reconcile",
    walletAddress,
    salt,
  }));
}

export async function markRobinhoodRecoveryAmbiguous(walletAddress: Address, salt: Hex) {
  return requestRecovery(RECOVERY_ENDPOINT, postBody({
    phase: "ambiguous",
    walletAddress,
    salt,
  }));
}


export function canonicalizeRecoveryForm(form: RobinhoodLaunchFormData): RobinhoodLaunchFormData {
  return {
    name: form.name.trim(),
    symbol: form.symbol.trim().toUpperCase(),
    description: form.description.trim(),
    logo: form.logo.trim(),
    twitter: form.twitter.trim(),
    telegram: form.telegram.trim(),
    website: form.website.trim(),
    initialBuyEth: form.initialBuyEth.trim() || "0",
    feeWallet: form.feeWallet.trim().toLowerCase(),
    hasAcceptedPermanentLock: form.hasAcceptedPermanentLock,
  };
}

export function isActiveRecovery(intent: RobinhoodRecoveryIntent) {
  return intent.status === "prepared" || intent.status === "submitted" || intent.status === "ambiguous";
}

export function assertPreparedRecovery(
  intent: RobinhoodRecoveryIntent | null,
  walletAddress: Address,
  salt: Hex,
  form: RobinhoodLaunchFormData,
) {
  if (!intent || intent.status !== "prepared" || intent.salt.toLowerCase() !== salt.toLowerCase()
    || intent.walletAddress.toLowerCase() !== walletAddress.toLowerCase()
    || !formsEqual(intent.config, form)) {
    throw new Error("Prepared recovery does not match this exact launch intent.");
  }
  return intent;
}

export function assertSubmittedRecovery(
  intent: RobinhoodRecoveryIntent | null,
  fallback: RobinhoodRecoveryIntent,
) {
  if (!intent || (intent.status !== "submitted" && intent.status !== "verified")
    || intent.salt.toLowerCase() !== fallback.salt.toLowerCase()
    || intent.transactionHash?.toLowerCase() !== fallback.transactionHash?.toLowerCase()) {
    throw new Error("Submitted recovery checkpoint does not match the wallet transaction.");
  }
  return intent;
}

export async function reconcileLocalPendingLaunch(
  walletAddress: Address,
  intent: RobinhoodRecoveryIntent | null,
  local: LocalRecoveryMarker,
) {
  if (!intent || intent.salt.toLowerCase() !== local.salt.toLowerCase()) {
    throw new Error("A locally recorded transaction does not match server recovery. New wallet requests are blocked.");
  }
  if (intent.status === "verified" || intent.status === "failed") return intent;
  if (local.kind === "ambiguous") {
    if (intent.status === "prepared") {
      return requireAmbiguous(await markRobinhoodRecoveryAmbiguous(walletAddress, local.salt), intent);
    }
    return requireReconciled(await reconcileRobinhoodRecovery(walletAddress, local.salt), intent);
  }
  if (intent.status === "prepared" || intent.status === "ambiguous") {
    return assertSubmittedRecovery(await submitRobinhoodRecovery(
      walletAddress,
      local.salt,
      local.transactionHash,
    ), { ...intent, status: "submitted", transactionHash: local.transactionHash });
  }
  if (intent.transactionHash?.toLowerCase() !== local.transactionHash.toLowerCase()) {
    throw new Error("The submitted transaction hash does not match local recovery.");
  }
  return intent;
}

export async function reconcileFallbackIntent(
  walletAddress: Address,
  intent: RobinhoodRecoveryIntent | null,
  fallback: RobinhoodRecoveryIntent,
) {
  if (!intent || intent.salt.toLowerCase() !== fallback.salt.toLowerCase()) {
    throw new Error("Active launch recovery could not be confirmed. New wallet requests are blocked.");
  }
  if (fallback.status === "submitted" && fallback.transactionHash) {
    if (intent.status === "prepared" || intent.status === "ambiguous") {
      return assertSubmittedRecovery(await submitRobinhoodRecovery(
        walletAddress,
        fallback.salt,
        fallback.transactionHash,
      ), fallback);
    }
    if (intent.transactionHash?.toLowerCase() !== fallback.transactionHash.toLowerCase()) {
      throw new Error("Recovered transaction hash does not match the wallet result.");
    }
  }
  return intent;
}

function requireAmbiguous(intent: RobinhoodRecoveryIntent | null, fallback: RobinhoodRecoveryIntent) {
  if (!intent || (intent.status !== "ambiguous" && intent.status !== "verified" && intent.status !== "failed")
    || intent.salt.toLowerCase() !== fallback.salt.toLowerCase()) {
    throw new Error("Ambiguous recovery checkpoint was not confirmed.");
  }
  return intent;
}

function requireReconciled(intent: RobinhoodRecoveryIntent | null, fallback: RobinhoodRecoveryIntent) {
  if (!intent || intent.salt.toLowerCase() !== fallback.salt.toLowerCase()) {
    throw new Error("Robinhood recovery reconciliation did not match the active intent.");
  }
  return intent;
}

async function requestRecovery(url: string, init?: RequestInit): Promise<RobinhoodRecoveryIntent | null> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string"
      ? body.error
      : "Robinhood launch recovery is unavailable.";
    throw new Error(message);
  }
  if (!isRecord(body) || !("intent" in body)) throw new Error("Invalid Robinhood recovery response.");
  if (body.intent === null) return null;
  return parseRobinhoodRecoveryIntent(body.intent);
}

export function parseRobinhoodRecoveryIntent(value: unknown): RobinhoodRecoveryIntent {
  if (!isRecord(value) || typeof value.id !== "string") throw new Error("Invalid Robinhood recovery intent.");
  if (!RECOVERY_STATUSES.includes(value.status as RecoveryStatus)) throw new Error("Invalid Robinhood recovery status.");
  if (!isAddressValue(value.walletAddress) || !isHexLength(value.salt, 64)) throw new Error("Invalid Robinhood recovery identity.");
  if (!isNullableHex(value.transactionHash) || !isNullableAddress(value.tokenAddress) || !isNullableAddress(value.poolAddress)) {
    throw new Error("Invalid Robinhood recovery transaction data.");
  }
  if (value.positionId !== null && typeof value.positionId !== "string") throw new Error("Invalid Robinhood recovery position.");
  if (value.error !== null && typeof value.error !== "string") throw new Error("Invalid Robinhood recovery error.");
  return {
    id: value.id,
    status: value.status as RecoveryStatus,
    walletAddress: value.walletAddress,
    salt: value.salt as Hex,
    transactionHash: value.transactionHash as Hash | null,
    config: parseForm(value.config),
    tokenAddress: value.tokenAddress,
    poolAddress: value.poolAddress,
    positionId: value.positionId,
    error: value.error,
  };
}

function parseForm(value: unknown): RobinhoodLaunchFormData {
  if (!isRecord(value)) throw new Error("Invalid Robinhood recovery form.");
  const fields = ["name", "symbol", "description", "logo", "twitter", "telegram", "website", "initialBuyEth", "feeWallet"] as const;
  for (const field of fields) {
    if (typeof value[field] !== "string") throw new Error(`Invalid recovered ${field}.`);
  }
  if (value.hasAcceptedPermanentLock !== true) throw new Error("Invalid recovered lock acceptance.");
  return Object.fromEntries([...fields.map((field) => [field, value[field]]), ["hasAcceptedPermanentLock", value.hasAcceptedPermanentLock]]) as unknown as RobinhoodLaunchFormData;
}

function postBody(body: Record<string, unknown>): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAddressValue(value: unknown): value is Address {
  return typeof value === "string" && isAddress(value, { strict: false });
}

function isNullableAddress(value: unknown): value is Address | null {
  return value === null || isAddressValue(value);
}

function isNullableHex(value: unknown): value is Hash | null {
  return value === null || isHexLength(value, 64);
}

function isHexLength(value: unknown, digits: number) {
  return typeof value === "string" && new RegExp(`^0x[0-9a-fA-F]{${digits}}$`).test(value);
}

function formsEqual(left: RobinhoodLaunchFormData, right: RobinhoodLaunchFormData) {
  return (Object.keys(left) as Array<keyof RobinhoodLaunchFormData>)
    .every((key) => left[key] === right[key]);
}
