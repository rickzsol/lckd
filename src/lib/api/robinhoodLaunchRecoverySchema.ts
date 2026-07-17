import {
  encodeFunctionData,
  getAddress,
  isAddress,
  maxUint256,
  parseEther,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import {
  PONS_FACTORY_ADDRESS,
  ROBINHOOD_CHAIN_ID,
  buildPonsLaunchRequest,
} from "@/lib/evm/pons";

export type RobinhoodIntentStatus = "prepared" | "ambiguous" | "submitted" | "verified" | "failed";

export interface RobinhoodLaunchConfig {
  name: string;
  symbol: string;
  description: string;
  logo: string;
  twitter: string;
  telegram: string;
  website: string;
  initialBuyEth: string;
  feeWallet: string;
  hasAcceptedPermanentLock: true;
}

export interface RobinhoodIntentRow {
  id: string;
  github_id: string;
  wallet_address: string;
  salt: string;
  config: RobinhoodLaunchConfig;
  initial_buy_wei: string;
  prepared_block_number: number;
  last_scanned_block: number;
  transaction_hash: string | null;
  token_address: string | null;
  pool_address: string | null;
  position_id: string | null;
  failure_reason: string | null;
  status: RobinhoodIntentStatus;
  expires_at: string;
}

export interface NormalizedRobinhoodIntent {
  walletAddress: Address;
  salt: Hex;
  config: RobinhoodLaunchConfig;
  initialBuyWei: bigint;
}

export interface RobinhoodTransaction {
  chainId: number;
  from: Address;
  to: Address | null;
  value: bigint;
  input: Hex;
}

export class RobinhoodRecoveryError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class RobinhoodRetryableError extends RobinhoodRecoveryError {
  readonly retryable = true;
}

const SALT_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ETH_PATTERN = /^(0|[1-9]\d*)(\.\d{1,18})?$/;

function normalizeAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new RobinhoodRecoveryError(`Invalid ${label}`, 400);
  }
  const address = getAddress(value).toLowerCase() as Address;
  if (address === "0x0000000000000000000000000000000000000000") {
    throw new RobinhoodRecoveryError(`${label} cannot be zero`, 400);
  }
  return address;
}

export function normalizeRobinhoodWallet(value: unknown): Address {
  return normalizeAddress(value, "wallet address");
}

export function normalizeRobinhoodSalt(value: unknown): Hex {
  if (typeof value !== "string" || !SALT_PATTERN.test(value)) {
    throw new RobinhoodRecoveryError("Salt must be bytes32", 400);
  }
  return value.toLowerCase() as Hex;
}

function normalizeText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new RobinhoodRecoveryError(`${label} must contain 1 to ${max} characters`, 400);
  }
  return value.trim();
}

function normalizeUri(value: unknown, label: string, allowIpfs = false, isRequired = false): string {
  if (typeof value !== "string") throw new RobinhoodRecoveryError(`Invalid ${label}`, 400);
  const normalized = value.trim();
  if (!normalized) {
    if (isRequired) throw new RobinhoodRecoveryError(`${label} is required`, 400);
    return "";
  }
  if (normalized.length > 2_048) throw new RobinhoodRecoveryError(`${label} URL is too long`, 400);
  if (allowIpfs && /^ipfs:\/\/[^\s/]+/.test(normalized)) return normalized;
  try {
    if (new URL(normalized).protocol === "https:") return normalized;
  } catch {
    // The uniform validation error below is intentional.
  }
  throw new RobinhoodRecoveryError(`${label} must be a valid HTTPS URL`, 400);
}

function normalizeConfig(input: unknown): { config: RobinhoodLaunchConfig; initialBuyWei: bigint } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RobinhoodRecoveryError("Invalid launch config", 400);
  }
  const source = input as Record<string, unknown>;
  const keys = ["name", "symbol", "description", "logo", "twitter", "telegram", "website", "initialBuyEth", "feeWallet", "hasAcceptedPermanentLock"];
  if (Object.keys(source).some((key) => !keys.includes(key))) {
    throw new RobinhoodRecoveryError("Launch config contains unsupported fields", 400);
  }
  const symbol = normalizeText(source.symbol, "Symbol", 10).toUpperCase();
  if (!/^[A-Z0-9]+$/.test(symbol)) throw new RobinhoodRecoveryError("Invalid token symbol", 400);
  const initialBuyEth = typeof source.initialBuyEth === "string" ? source.initialBuyEth.trim() : "";
  if (!ETH_PATTERN.test(initialBuyEth)) throw new RobinhoodRecoveryError("Invalid initial buy amount", 400);
  if (source.hasAcceptedPermanentLock !== true) {
    throw new RobinhoodRecoveryError("Permanent liquidity lock acceptance is required", 400);
  }
  const config: RobinhoodLaunchConfig = {
    name: normalizeText(source.name, "Name", 64),
    symbol,
    description: normalizeText(source.description, "Description", 500),
    logo: normalizeUri(source.logo, "Logo", true, true),
    twitter: normalizeUri(source.twitter, "Twitter"),
    telegram: normalizeUri(source.telegram, "Telegram"),
    website: normalizeUri(source.website, "Website"),
    initialBuyEth,
    feeWallet: normalizeAddress(source.feeWallet, "fee wallet"),
    hasAcceptedPermanentLock: true,
  };
  return { config, initialBuyWei: parseEther(initialBuyEth) };
}

export function normalizeRobinhoodIntent(input: {
  walletAddress: unknown;
  salt: unknown;
  config: unknown;
}): NormalizedRobinhoodIntent {
  const salt = normalizeRobinhoodSalt(input.salt);
  const walletAddress = normalizeRobinhoodWallet(input.walletAddress);
  const { config, initialBuyWei } = normalizeConfig(input.config);
  const normalized = { walletAddress, salt, config, initialBuyWei };
  if (buildRobinhoodRequest(normalized).value > maxUint256) {
    throw new RobinhoodRecoveryError("Initial buy amount is too large", 400);
  }
  return normalized;
}

export function normalizeRobinhoodHash(value: unknown): Hash {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new RobinhoodRecoveryError("Transaction hash must be bytes32", 400);
  }
  return value.toLowerCase() as Hash;
}

export function buildRobinhoodRequest(intent: NormalizedRobinhoodIntent) {
  return buildPonsLaunchRequest({
    name: intent.config.name,
    symbol: intent.config.symbol,
    description: intent.config.description,
    logo: intent.config.logo,
    socials: { twitter: intent.config.twitter, telegram: intent.config.telegram, website: intent.config.website },
    feeWallet: intent.config.feeWallet as Address,
    initialBuyWei: intent.initialBuyWei,
    salt: intent.salt,
  });
}

export function isSameRobinhoodIntent(row: RobinhoodIntentRow, intent: NormalizedRobinhoodIntent): boolean {
  const stored = normalizeRobinhoodIntent({
    walletAddress: row.wallet_address,
    salt: row.salt,
    config: row.config,
  });
  const storedRequest = buildRobinhoodRequest(stored);
  const nextRequest = buildRobinhoodRequest(intent);
  return stored.salt === intent.salt
    && stored.walletAddress === intent.walletAddress
    && row.initial_buy_wei === intent.initialBuyWei.toString()
    && stored.initialBuyWei === intent.initialBuyWei
    && encodeFunctionData(storedRequest) === encodeFunctionData(nextRequest);
}

export function assertRobinhoodTransactionMatches(transaction: RobinhoodTransaction, intent: NormalizedRobinhoodIntent): void {
  const request = buildRobinhoodRequest(intent);
  const checks: Array<[string, unknown, unknown]> = [
    ["chain ID", transaction.chainId, ROBINHOOD_CHAIN_ID],
    ["sender", transaction.from.toLowerCase(), intent.walletAddress],
    ["factory", transaction.to?.toLowerCase(), PONS_FACTORY_ADDRESS.toLowerCase()],
    ["value", transaction.value, request.value],
    ["calldata", transaction.input.toLowerCase(), encodeFunctionData(request).toLowerCase()],
  ];
  const mismatch = checks.find(([, actual, expected]) => actual !== expected);
  if (mismatch) throw new RobinhoodRecoveryError(`Submitted transaction ${mismatch[0]} does not match intent`, 422);
}

export function robinhoodIntentResponse(row: RobinhoodIntentRow) {
  return {
    id: row.id,
    status: row.status,
    walletAddress: row.wallet_address,
    salt: row.salt,
    transactionHash: row.transaction_hash,
    config: row.config,
    tokenAddress: row.token_address,
    poolAddress: row.pool_address,
    positionId: row.position_id,
    error: row.failure_reason,
  };
}
