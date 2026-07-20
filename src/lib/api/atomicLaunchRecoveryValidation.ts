import { createHash } from "node:crypto";
import { z } from "zod";
import { isValidSolanaAddress } from "./validation";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const ATOMIC_LAUNCH_STATUSES = [
  "prepared",
  "alt_setup_submitted",
  "alt_ready",
  "atomic_submitted",
  "completed",
  "cleanup_required",
  "abandoned",
] as const;

export type AtomicLaunchStatus = (typeof ATOMIC_LAUNCH_STATUSES)[number];

export function replacementState(
  status: { err: unknown; confirmationStatus?: string | null } | null,
  isBlockhashValid: boolean,
): "failed-or-absent" | "finalized" | "processing" | "blockhash-valid" {
  if (!status || status.err) {
    return isBlockhashValid ? "blockhash-valid" : "failed-or-absent";
  }
  return status.confirmationStatus === "finalized" ? "finalized" : "processing";
}

export function hasFinalizedIssuedTupleExpired(
  finalizedBlockHeight: number,
  lastValidBlockHeight: number,
  isBlockhashValid: boolean,
): boolean {
  return Number.isSafeInteger(finalizedBlockHeight) && finalizedBlockHeight >= 0 &&
    Number.isSafeInteger(lastValidBlockHeight) && lastValidBlockHeight >= 0 &&
    finalizedBlockHeight > lastValidBlockHeight && !isBlockhashValid;
}

export function classifyExactIssuedReceipt(
  confirmationStatus: string | null | undefined,
): "processing" | "finalized" {
  return confirmationStatus === "finalized" ? "finalized" : "processing";
}

const HTTPS_URL_MAX = 500;
const httpsUrl = z.string().url().max(HTTPS_URL_MAX).refine(
  (value) => new URL(value).protocol === "https:",
  "URL must use HTTPS",
);
const nullableHttpsUrl = httpsUrl.nullable();
const address = z.string().refine(isValidSolanaAddress, "Invalid Solana address");
const signature = z.string().min(64).max(90);
const blockhash = z.string().min(32).max(64);
const blockHeight = z.number().int().nonnegative().safe();
const positiveSafeInteger = z.number().int().positive().safe();
const stateVersion = z.number().int().nonnegative().safe();
const serializedTransaction = z.string().min(100).max(2_000).regex(
  /^[A-Za-z0-9+/]+={0,2}$/,
  "Invalid serialized transaction",
);

export const launchFeeConfigFields = {
  feeMode: z.enum(["waived", "burnLckd", "sol", "buybackBurn"]).optional(),
  feeLamports: z.number().int().positive().safe().nullable().optional(),
  feeLckdRaw: z.string().regex(/^\d+$/).nullable().optional(),
  feeTreasury: address.nullable().optional(),
} as const;

export const atomicLaunchConfigSchema = z.object({
  name: z.string().trim().min(1).max(32),
  ticker: z.string().trim().min(1).max(13),
  description: z.string().max(1000),
  buyAmountSol: z.number().finite().min(0.01).max(100),
  hasLock: z.boolean().default(true),
  lockDurationDays: z.number().int().min(7).max(365),
  lockPercentage: z.number().int().min(51).max(99),
  githubUsername: z.string().min(1).max(39).nullable(),
  githubRepo: z.string().max(200).nullable(),
  liveUrl: nullableHttpsUrl,
  twitterUrl: nullableHttpsUrl,
  telegramUrl: nullableHttpsUrl,
  websiteUrl: nullableHttpsUrl,
  ...launchFeeConfigFields,
}).strict();

export const atomicLaunchMetadataSchema = z.object({
  metadataUri: httpsUrl.max(200),
  imageUri: httpsUrl,
  name: z.string().trim().min(1).max(32),
  ticker: z.string().trim().min(1).max(13),
  description: z.string().max(1000),
  twitterUrl: nullableHttpsUrl,
  telegramUrl: nullableHttpsUrl,
  websiteUrl: nullableHttpsUrl,
}).strict();

export const prepareAtomicLaunchSchema = z.object({
  githubId: z.string().min(1).max(255),
  creatorWallet: address,
  mintAddress: address,
  config: atomicLaunchConfigSchema,
  metadata: atomicLaunchMetadataSchema,
  metadataAddress: address,
  altAddress: address,
  altAddresses: z.array(address).min(1).max(256).refine(
    (values) => new Set(values).size === values.length,
    "ALT addresses must be unique",
  ),
  quotedTokenAmount: z.string().regex(/^\d+$/),
  maxQuoteAmount: z.string().regex(/^\d+$/),
  plannedLockAmount: z.string().regex(/^\d+$/),
  plannedUnlockTimestamp: z.number().int().nonnegative().safe(),
  plannedStreamflowFeePercent: z.number().finite().min(0).lt(100),
  setupMessageHash: z.string().regex(/^[0-9a-f]{64}$/),
  setupBlockhash: blockhash,
  setupLastValidBlockHeight: blockHeight,
  issuedSetupRecentSlot: positiveSafeInteger,
  issuedSetupTransaction: serializedTransaction,
  expiresAt: z.string().datetime(),
}).strict();

const ownedIntentSchema = z.object({
  githubId: z.string().min(1).max(255),
  creatorWallet: address,
  mintAddress: address,
  expectedStateVersion: stateVersion,
}).strict();

export const issueAtomicTransactionSchema = ownedIntentSchema.extend({
  quotedTokenAmount: z.string().regex(/^\d+$/),
  maxQuoteAmount: z.string().regex(/^\d+$/),
  messageHash: z.string().regex(/^[0-9a-f]{64}$/),
  blockhash,
  lastValidBlockHeight: blockHeight,
  lockAmount: z.string().regex(/^\d+$/),
  unlockTimestamp: z.number().int().nonnegative().safe(),
  issuedAtomicTransaction: serializedTransaction,
}).strict();

export const transactionCheckpointSchema = ownedIntentSchema.extend({
  previousSignature: signature.nullable(),
  signature,
  blockhash,
  lastValidBlockHeight: blockHeight,
  finalizedBlockHeight: blockHeight,
  transaction: z.string().min(100).max(2_000).optional(),
}).strict();

export const altReadyCheckpointSchema = ownedIntentSchema.extend({
  setupSignature: signature,
}).strict();

export const atomicTransactionCheckpointSchema = transactionCheckpointSchema.extend({
  lockMetadataId: address,
  lockAmount: z.string().regex(/^\d+$/),
  unlockTimestamp: z.number().int().nonnegative().safe(),
}).strict();

export const cleanupRequestSchema = ownedIntentSchema.extend({
  finalizedBlockHeight: blockHeight,
}).strict();

export const issueAltCleanupSchema = ownedIntentSchema.extend({
  expectedAltStateVersion: stateVersion,
  phase: z.enum(["deactivate", "close"]),
  messageHash: z.string().regex(/^[0-9a-f]{64}$/),
  blockhash,
  lastValidBlockHeight: blockHeight,
  finalizedBlockHeight: blockHeight,
}).strict();

export const altCleanupTransactionCheckpointSchema = transactionCheckpointSchema.extend({
  expectedAltStateVersion: stateVersion,
}).strict();

export const altClosedCheckpointSchema = ownedIntentSchema.extend({
  expectedAltStateVersion: stateVersion,
  closeSignature: signature,
}).strict();

export const verifiedAtomicLaunchSchema = ownedIntentSchema.extend({
  metadataUri: httpsUrl.max(200),
  atomicTxSignature: signature,
  lockMetadataId: address,
  name: z.string().trim().min(1).max(32),
  ticker: z.string().trim().min(1).max(13),
  description: z.string().max(1000),
  imageUri: httpsUrl,
  lockDurationDays: z.number().int().min(7).max(365),
  lockPercentage: z.number().finite().positive().max(100),
  lockUnlockAt: z.string().datetime(),
  lockAmount: z.string().regex(/^\d+$/),
  lockDebitedAmount: z.string().regex(/^\d+$/),
  purchasedAmount: z.string().regex(/^\d+$/),
  buyAmountSol: z.number().finite().positive().max(100),
  githubUsername: z.string().min(1).max(39).nullable(),
  githubRepo: z.string().max(200).nullable(),
  liveUrl: nullableHttpsUrl,
  twitterUrl: nullableHttpsUrl,
  telegramUrl: nullableHttpsUrl,
  websiteUrl: nullableHttpsUrl,
  verifiedAt: z.string().datetime(),
}).strict();

export const getOwnedAtomicLaunchSchema = z.object({
  githubId: z.string().min(1).max(255),
  creatorWallet: address,
  mintAddress: address.nullable().optional(),
}).strict();

export const atomicRpcResultSchema = z.object({
  intentId: z.string().uuid(),
  status: z.enum(ATOMIC_LAUNCH_STATUSES),
  stateVersion,
  altStatus: z.enum([
    "planned",
    "setup_submitted",
    "ready",
    "deactivating",
    "close_submitted",
    "closed",
  ]),
  altStateVersion: stateVersion,
  replayed: z.boolean(),
  updated: z.boolean().optional(),
}).strict();

const nullableReceiptText = z.string().nullable();
const nullableHeight = blockHeight.nullable();
export const atomicIntentSnapshotSchema = z.object({
  intentId: z.string().uuid(),
  githubId: z.string().min(1).max(255),
  creatorWallet: address,
  mintAddress: address,
  status: z.enum(ATOMIC_LAUNCH_STATUSES),
  stateVersion,
  config: atomicLaunchConfigSchema,
  configHash: z.string().regex(/^[0-9a-f]{64}$/),
  metadata: atomicLaunchMetadataSchema,
  metadataHash: z.string().regex(/^[0-9a-f]{64}$/),
  metadataUri: httpsUrl.max(200),
  imageUri: httpsUrl,
  metadataAddress: address,
  altAddress: address,
  altAddresses: z.array(address).min(1).max(256),
  altAddressesHash: z.string().regex(/^[0-9a-f]{64}$/),
  quotedTokenAmount: z.string().regex(/^\d+$/),
  maxQuoteAmount: z.string().regex(/^\d+$/),
  plannedLockAmount: z.string().regex(/^\d+$/).nullable(),
  plannedUnlockTimestamp: nullableHeight,
  plannedStreamflowFeePercent: z.number().finite().min(0).lt(100).nullable(),
  issuedAtomicMessageHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  issuedAtomicBlockhash: nullableReceiptText,
  issuedAtomicLastValidBlockHeight: nullableHeight,
  issuedLockAmount: z.string().regex(/^\d+$/).nullable(),
  issuedUnlockTimestamp: nullableHeight,
  issuedAtomicTransaction: serializedTransaction.nullable(),
  atomicTx: nullableReceiptText,
  atomicBlockhash: nullableReceiptText,
  atomicLastValidBlockHeight: nullableHeight,
  lockMetadataId: nullableReceiptText,
  lockAmount: nullableReceiptText,
  unlockTimestamp: nullableHeight,
  expiresAt: z.string().datetime({ offset: true }),
  altStatus: z.enum([
    "planned",
    "setup_submitted",
    "ready",
    "deactivating",
    "close_submitted",
    "closed",
  ]),
  altStateVersion: stateVersion,
  setupTx: nullableReceiptText,
  setupBlockhash: nullableReceiptText,
  setupLastValidBlockHeight: nullableHeight,
  issuedSetupMessageHash: z.string().regex(/^[0-9a-f]{64}$/),
  issuedSetupBlockhash: blockhash,
  issuedSetupLastValidBlockHeight: blockHeight,
  issuedSetupRecentSlot: positiveSafeInteger.nullable(),
  issuedSetupTransaction: serializedTransaction.nullable(),
  issuedCleanupPhase: z.enum(["deactivate", "close"]).nullable(),
  issuedCleanupMessageHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  issuedCleanupBlockhash: nullableReceiptText,
  issuedCleanupLastValidBlockHeight: nullableHeight,
  altDeactivationTx: nullableReceiptText,
  altDeactivationBlockhash: nullableReceiptText,
  altDeactivationLastValidBlockHeight: nullableHeight,
  altCloseTx: nullableReceiptText,
  altCloseBlockhash: nullableReceiptText,
  altCloseLastValidBlockHeight: nullableHeight,
  altSetupExpired: z.boolean(),
}).strict();

export type PrepareAtomicLaunchInput = z.infer<typeof prepareAtomicLaunchSchema>;
export type IssueAtomicTransactionInput = z.infer<typeof issueAtomicTransactionSchema>;
export type TransactionCheckpointInput = z.infer<typeof transactionCheckpointSchema>;
export type AltReadyCheckpointInput = z.infer<typeof altReadyCheckpointSchema>;
export type AtomicTransactionCheckpointInput = z.infer<
  typeof atomicTransactionCheckpointSchema
>;
export type CleanupRequestInput = z.infer<typeof cleanupRequestSchema>;
export type IssueAltCleanupInput = z.infer<typeof issueAltCleanupSchema>;
export type AltCleanupTransactionCheckpointInput = z.infer<
  typeof altCleanupTransactionCheckpointSchema
>;
export type AltClosedCheckpointInput = z.infer<typeof altClosedCheckpointSchema>;
export type VerifiedAtomicLaunchInput = z.infer<typeof verifiedAtomicLaunchSchema>;
export type AtomicRpcResult = z.infer<typeof atomicRpcResultSchema>;
export type GetOwnedAtomicLaunchInput = z.infer<typeof getOwnedAtomicLaunchSchema>;
export type AtomicIntentSnapshot = z.infer<typeof atomicIntentSnapshotSchema>;

const ALLOWED_TRANSITIONS: Record<AtomicLaunchStatus, readonly AtomicLaunchStatus[]> = {
  prepared: ["alt_setup_submitted", "abandoned"],
  alt_setup_submitted: ["alt_setup_submitted", "alt_ready", "abandoned"],
  alt_ready: ["atomic_submitted", "cleanup_required"],
  atomic_submitted: ["atomic_submitted", "completed", "cleanup_required"],
  completed: ["completed"],
  cleanup_required: ["cleanup_required", "abandoned"],
  abandoned: ["abandoned"],
};

export function canTransitionAtomicStatus(
  current: AtomicLaunchStatus,
  next: AtomicLaunchStatus,
): boolean {
  return ALLOWED_TRANSITIONS[current].includes(next);
}

export function canDeactivateAtomicLookupTable(
  status: AtomicLaunchStatus,
  fee: {
    feeMode?: "waived" | "burnLckd" | "sol" | "buybackBurn";
    feeLamports?: number | null;
  },
): boolean {
  return status === "cleanup_required" ||
    (status === "completed" && fee.feeMode === "buybackBurn" &&
      fee.feeLamports === 100_000_000);
}

export function isExactTransactionReplay(
  current: { signature: string; blockhash: string; lastValidBlockHeight: number },
  candidate: { signature: string; blockhash: string; lastValidBlockHeight: number },
): boolean {
  return current.signature === candidate.signature &&
    current.blockhash === candidate.blockhash &&
    current.lastValidBlockHeight === candidate.lastValidBlockHeight;
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function hashCanonicalJson(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function hashOrderedAddresses(addresses: readonly string[]): string {
  return hashCanonicalJson([...addresses]);
}
