import "server-only";

import { getServerClient } from "@/lib/supabase";
import {
  altClosedCheckpointSchema,
  altCleanupTransactionCheckpointSchema,
  altReadyCheckpointSchema,
  atomicRpcResultSchema,
  atomicIntentSnapshotSchema,
  atomicTransactionCheckpointSchema,
  cleanupRequestSchema,
  hashCanonicalJson,
  hashOrderedAddresses,
  issueAtomicTransactionSchema,
  issueAltCleanupSchema,
  getOwnedAtomicLaunchSchema,
  prepareAtomicLaunchSchema,
  transactionCheckpointSchema,
  verifiedAtomicLaunchSchema,
  type AltClosedCheckpointInput,
  type AltCleanupTransactionCheckpointInput,
  type AltReadyCheckpointInput,
  type AtomicRpcResult,
  type AtomicIntentSnapshot,
  type AtomicTransactionCheckpointInput,
  type CleanupRequestInput,
  type JsonValue,
  type IssueAtomicTransactionInput,
  type IssueAltCleanupInput,
  type GetOwnedAtomicLaunchInput,
  type PrepareAtomicLaunchInput,
  type TransactionCheckpointInput,
  type VerifiedAtomicLaunchInput,
} from "./atomicLaunchRecoveryValidation";

export class AtomicLaunchRecoveryError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function parseResult(data: unknown): AtomicRpcResult {
  const parsed = atomicRpcResultSchema.safeParse(data);
  if (!parsed.success) {
    throw new AtomicLaunchRecoveryError("Atomic launch recovery returned invalid state", 503);
  }
  return parsed.data;
}

function rpcError(error: { code?: string; message?: string } | null): never {
  const isConflict = error?.code === "23505" ||
    error?.code === "23514" ||
    error?.code === "40001" ||
    error?.code === "55000";
  throw new AtomicLaunchRecoveryError(
    isConflict ? "Atomic launch recovery state changed" : "Atomic launch recovery is unavailable",
    isConflict ? 409 : 503,
  );
}

function invalidInput(): never {
  throw new AtomicLaunchRecoveryError("Invalid atomic launch recovery input", 400);
}

export async function getOwnedAtomicLaunchIntent(
  input: GetOwnedAtomicLaunchInput,
): Promise<AtomicIntentSnapshot | null> {
  const parsed = getOwnedAtomicLaunchSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  const value = parsed.data;
  const { data, error } = await getServerClient().rpc("get_owned_atomic_launch_intent", {
    p_github_id: value.githubId,
    p_creator_wallet: value.creatorWallet,
    p_mint_address: value.mintAddress ?? null,
  });
  if (error) rpcError(error);
  if (data === null) return null;
  const snapshot = atomicIntentSnapshotSchema.safeParse(data);
  if (!snapshot.success) {
    throw new AtomicLaunchRecoveryError("Atomic launch recovery returned invalid state", 503);
  }
  return snapshot.data;
}

export async function prepareAtomicLaunchIntent(
  input: PrepareAtomicLaunchInput,
): Promise<AtomicRpcResult> {
  const parsed = prepareAtomicLaunchSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  const value = parsed.data;
  const configHash = hashCanonicalJson(value.config as JsonValue);
  const metadataHash = hashCanonicalJson(value.metadata as JsonValue);
  const altAddressesHash = hashOrderedAddresses(value.altAddresses);
  const { data, error } = await getServerClient().rpc("atomic_prepare_launch_intent", {
    p_github_id: value.githubId,
    p_creator_wallet: value.creatorWallet,
    p_mint_address: value.mintAddress,
    p_metadata_uri: value.metadata.metadataUri,
    p_image_uri: value.metadata.imageUri,
    p_config: value.config,
    p_config_hash: configHash,
    p_metadata: value.metadata,
    p_metadata_hash: metadataHash,
    p_metadata_address: value.metadataAddress,
    p_alt_address: value.altAddress,
    p_alt_addresses: value.altAddresses,
    p_alt_addresses_hash: altAddressesHash,
    p_quoted_token_amount: value.quotedTokenAmount,
    p_max_quote_amount: value.maxQuoteAmount,
    p_issued_setup_message_hash: value.setupMessageHash,
    p_issued_setup_blockhash: value.setupBlockhash,
    p_issued_setup_last_valid_block_height: value.setupLastValidBlockHeight,
    p_expires_at: value.expiresAt,
  });
  if (error) rpcError(error);
  return parseResult(data);
}

export async function issueAtomicTransaction(
  input: IssueAtomicTransactionInput,
): Promise<AtomicRpcResult> {
  const parsed = issueAtomicTransactionSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  const value = parsed.data;
  const { data, error } = await getServerClient().rpc("atomic_issue_transaction", {
    p_github_id: value.githubId,
    p_creator_wallet: value.creatorWallet,
    p_mint_address: value.mintAddress,
    p_expected_state_version: value.expectedStateVersion,
    p_quoted_token_amount: value.quotedTokenAmount,
    p_max_quote_amount: value.maxQuoteAmount,
    p_message_hash: value.messageHash,
    p_blockhash: value.blockhash,
    p_last_valid_block_height: value.lastValidBlockHeight,
    p_lock_amount: value.lockAmount,
    p_unlock_timestamp: value.unlockTimestamp,
  });
  if (error) rpcError(error);
  return parseResult(data);
}

export async function checkpointAtomicAltSetupSubmitted(
  input: TransactionCheckpointInput,
): Promise<AtomicRpcResult> {
  const parsed = transactionCheckpointSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  const value = parsed.data;
  const { data, error } = await getServerClient().rpc(
    "atomic_checkpoint_alt_setup_submitted",
    {
      p_github_id: value.githubId,
      p_creator_wallet: value.creatorWallet,
      p_mint_address: value.mintAddress,
      p_expected_state_version: value.expectedStateVersion,
      p_previous_signature: value.previousSignature,
      p_setup_signature: value.signature,
      p_setup_blockhash: value.blockhash,
      p_setup_last_valid_block_height: value.lastValidBlockHeight,
      p_finalized_block_height: value.finalizedBlockHeight,
    },
  );
  if (error) rpcError(error);
  return parseResult(data);
}

export async function checkpointAtomicAltReady(
  input: AltReadyCheckpointInput,
): Promise<AtomicRpcResult> {
  const parsed = altReadyCheckpointSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  const value = parsed.data;
  const { data, error } = await getServerClient().rpc("atomic_checkpoint_alt_ready", {
    p_github_id: value.githubId,
    p_creator_wallet: value.creatorWallet,
    p_mint_address: value.mintAddress,
    p_expected_state_version: value.expectedStateVersion,
    p_setup_signature: value.setupSignature,
  });
  if (error) rpcError(error);
  return parseResult(data);
}

export async function checkpointAtomicTransactionSubmitted(
  input: AtomicTransactionCheckpointInput,
): Promise<AtomicRpcResult> {
  const parsed = atomicTransactionCheckpointSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  const value = parsed.data;
  const { data, error } = await getServerClient().rpc(
    "atomic_checkpoint_atomic_submitted",
    {
      p_github_id: value.githubId,
      p_creator_wallet: value.creatorWallet,
      p_mint_address: value.mintAddress,
      p_expected_state_version: value.expectedStateVersion,
      p_previous_signature: value.previousSignature,
      p_atomic_signature: value.signature,
      p_lock_metadata_id: value.lockMetadataId,
      p_lock_amount: value.lockAmount,
      p_unlock_timestamp: value.unlockTimestamp,
      p_atomic_blockhash: value.blockhash,
      p_atomic_last_valid_block_height: value.lastValidBlockHeight,
      p_finalized_block_height: value.finalizedBlockHeight,
    },
  );
  if (error) rpcError(error);
  return parseResult(data);
}

export async function requestAtomicCleanup(
  input: CleanupRequestInput,
): Promise<AtomicRpcResult> {
  const parsed = cleanupRequestSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  const value = parsed.data;
  const { data, error } = await getServerClient().rpc("atomic_request_cleanup", {
    p_github_id: value.githubId,
    p_creator_wallet: value.creatorWallet,
    p_mint_address: value.mintAddress,
    p_expected_state_version: value.expectedStateVersion,
    p_finalized_block_height: value.finalizedBlockHeight,
  });
  if (error) rpcError(error);
  return parseResult(data);
}

export async function issueAtomicAltCleanup(
  input: IssueAltCleanupInput,
): Promise<AtomicRpcResult> {
  const parsed = issueAltCleanupSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  const value = parsed.data;
  const { data, error } = await getServerClient().rpc("atomic_issue_alt_cleanup", {
    p_github_id: value.githubId,
    p_creator_wallet: value.creatorWallet,
    p_mint_address: value.mintAddress,
    p_expected_state_version: value.expectedStateVersion,
    p_expected_alt_state_version: value.expectedAltStateVersion,
    p_phase: value.phase,
    p_message_hash: value.messageHash,
    p_blockhash: value.blockhash,
    p_last_valid_block_height: value.lastValidBlockHeight,
    p_finalized_block_height: value.finalizedBlockHeight,
  });
  if (error) rpcError(error);
  return parseResult(data);
}

export async function checkpointAtomicAltDeactivating(
  input: AltCleanupTransactionCheckpointInput,
): Promise<AtomicRpcResult> {
  const parsed = altCleanupTransactionCheckpointSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  const value = parsed.data;
  const { data, error } = await getServerClient().rpc(
    "atomic_checkpoint_alt_deactivating",
    {
      p_github_id: value.githubId,
      p_creator_wallet: value.creatorWallet,
      p_mint_address: value.mintAddress,
      p_expected_state_version: value.expectedStateVersion,
      p_expected_alt_state_version: value.expectedAltStateVersion,
      p_previous_signature: value.previousSignature,
      p_deactivation_signature: value.signature,
      p_deactivation_blockhash: value.blockhash,
      p_deactivation_last_valid_block_height: value.lastValidBlockHeight,
      p_finalized_block_height: value.finalizedBlockHeight,
    },
  );
  if (error) rpcError(error);
  return parseResult(data);
}

export async function checkpointAtomicAltCloseSubmitted(
  input: AltCleanupTransactionCheckpointInput,
): Promise<AtomicRpcResult> {
  const parsed = altCleanupTransactionCheckpointSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  const value = parsed.data;
  const { data, error } = await getServerClient().rpc(
    "atomic_checkpoint_alt_close_submitted",
    {
      p_github_id: value.githubId,
      p_creator_wallet: value.creatorWallet,
      p_mint_address: value.mintAddress,
      p_expected_state_version: value.expectedStateVersion,
      p_expected_alt_state_version: value.expectedAltStateVersion,
      p_previous_signature: value.previousSignature,
      p_close_signature: value.signature,
      p_close_blockhash: value.blockhash,
      p_close_last_valid_block_height: value.lastValidBlockHeight,
      p_finalized_block_height: value.finalizedBlockHeight,
    },
  );
  if (error) rpcError(error);
  return parseResult(data);
}

export async function checkpointAtomicAltClosed(
  input: AltClosedCheckpointInput,
): Promise<AtomicRpcResult> {
  const parsed = altClosedCheckpointSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  const value = parsed.data;
  const { data, error } = await getServerClient().rpc("atomic_checkpoint_alt_closed", {
    p_github_id: value.githubId,
    p_creator_wallet: value.creatorWallet,
    p_mint_address: value.mintAddress,
    p_expected_state_version: value.expectedStateVersion,
    p_expected_alt_state_version: value.expectedAltStateVersion,
    p_close_signature: value.closeSignature,
  });
  if (error) rpcError(error);
  return parseResult(data);
}

export async function recordVerifiedAtomicLaunch(
  input: VerifiedAtomicLaunchInput,
): Promise<AtomicRpcResult> {
  const parsed = verifiedAtomicLaunchSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  const value = parsed.data;
  const { data, error } = await getServerClient().rpc("record_verified_atomic_launch", {
    p_github_id: value.githubId,
    p_creator_wallet: value.creatorWallet,
    p_mint_address: value.mintAddress,
    p_metadata_uri: value.metadataUri,
    p_atomic_tx: value.atomicTxSignature,
    p_lock_metadata_id: value.lockMetadataId,
    p_name: value.name,
    p_ticker: value.ticker,
    p_description: value.description,
    p_image_uri: value.imageUri,
    p_lock_duration_days: value.lockDurationDays,
    p_lock_percentage: value.lockPercentage,
    p_lock_unlock_at: value.lockUnlockAt,
    p_lock_amount: value.lockAmount,
    p_lock_debited_amount: value.lockDebitedAmount,
    p_purchased_amount: value.purchasedAmount,
    p_buy_amount_sol: value.buyAmountSol,
    p_github_username: value.githubUsername,
    p_github_repo: value.githubRepo,
    p_live_url: value.liveUrl,
    p_twitter_url: value.twitterUrl,
    p_telegram_url: value.telegramUrl,
    p_website_url: value.websiteUrl,
    p_verified_at: value.verifiedAt,
    p_expected_state_version: value.expectedStateVersion,
  });
  if (error) rpcError(error);
  return parseResult(data);
}
