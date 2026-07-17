import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { requireLinkedWallet, type LinkedWalletSession } from "@/lib/api/auth";
import { requireSameOrigin } from "@/lib/api/origin";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { getServerClient } from "@/lib/supabase";
import { isValidSolanaAddress } from "@/lib/api/validation";
import {
  OnChainVerificationError,
  verifyFinalizedAtomicLaunchTransaction,
} from "@/lib/api/onchain";
import { fetchApprovedMetadata } from "@/lib/api/finalizedMetadata";
import { triggerFinalizedLockAttestation } from "@/lib/sas/lockTrigger";

export { OPTIONS };

const solanaAddress = z.string().refine(isValidSolanaAddress, "Invalid Solana address");
const transactionSignature = z.string().min(64).max(90);
const httpsUrl = z.string().url().max(500).refine(
  (value) => new URL(value).protocol === "https:",
  "URL must use HTTPS",
);
const nullableUrl = httpsUrl.nullable().default(null);

const atomicRecordSchema = z.object({
  mintAddress: solanaAddress,
  creatorWallet: solanaAddress,
  atomicTxSignature: transactionSignature,
  lockMetadataId: solanaAddress,
}).strict();

const storedConfigSchema = z.object({
  name: z.string().trim().min(1).max(32),
  ticker: z.string().trim().min(1).max(13),
  description: z.string().max(1000),
  lockDurationDays: z.number().int().min(7).max(365),
  lockPercentage: z.number().int().min(51).max(99),
  buyAmountSol: z.number().finite().positive().max(100),
  githubUsername: z.string().nullable(),
  githubRepo: z.string().max(200).nullable(),
  liveUrl: nullableUrl,
  twitterUrl: nullableUrl,
  telegramUrl: nullableUrl,
  websiteUrl: nullableUrl,
}).passthrough();

const atomicIntentSchema = z.object({
  status: z.enum(["atomic_submitted", "completed"]),
  stateVersion: z.number().int().nonnegative().safe(),
  creatorWallet: solanaAddress,
  mintAddress: solanaAddress,
  metadataAddress: solanaAddress,
  metadataUri: httpsUrl.max(200),
  imageUri: httpsUrl,
  config: storedConfigSchema,
  altAddress: solanaAddress,
  altAddresses: z.array(solanaAddress).min(1).max(256),
  quotedTokenAmount: z.string().regex(/^\d+$/),
  maxQuoteAmount: z.string().regex(/^\d+$/),
  atomicTx: transactionSignature,
  lockMetadataId: solanaAddress,
  lockAmount: z.string().regex(/^\d+$/),
  unlockTimestamp: z.number().int().positive().safe(),
}).passthrough();

const atomicRecordResultSchema = z.object({
  status: z.literal("completed"),
  stateVersion: z.number().int().nonnegative().safe(),
  altStatus: z.enum(["deactivating", "close_submitted", "closed"]),
  altStateVersion: z.number().int().nonnegative().safe(),
  replayed: z.boolean(),
  updated: z.boolean(),
}).passthrough();

function verificationError(error: unknown) {
  if (error instanceof OnChainVerificationError) {
    return apiError(error.message, error.status);
  }
  console.error("[token/record] On-chain verification failed:", error);
  return apiError("On-chain verification is unavailable", 503);
}

function persistenceError(error: { code?: string; message: string }) {
  console.error("[token/record] Persistence failed:", error.message);
  const isConflict = ["23505", "23514", "40001", "55000"].includes(error.code ?? "");
  return apiError(
    isConflict ? "Launch recovery state does not match finalized receipts" : "Failed to record token",
    isConflict ? 409 : 503,
  );
}

async function recordAtomicLaunch(
  body: z.infer<typeof atomicRecordSchema>,
  session: LinkedWalletSession,
) {
  if (body.creatorWallet !== session.wallet_address) {
    return apiError("creatorWallet does not match the linked wallet", 403);
  }

  const serverClient = getServerClient();
  const { data: intentData, error: intentError } = await serverClient.rpc(
    "get_owned_atomic_launch_intent",
    {
      p_github_id: session.github_id,
      p_creator_wallet: session.wallet_address,
      p_mint_address: body.mintAddress,
    },
  );
  if (intentError) return apiError("Atomic launch recovery is unavailable", 503);
  const parsedIntent = atomicIntentSchema.safeParse(intentData);
  if (!parsedIntent.success) {
    return apiError("Atomic launch does not match its reviewed intent", 422);
  }
  const intent = parsedIntent.data;
  if (
    intent.creatorWallet !== session.wallet_address ||
    intent.mintAddress !== body.mintAddress ||
    intent.atomicTx !== body.atomicTxSignature ||
    intent.metadataAddress !== body.lockMetadataId ||
    intent.lockMetadataId !== body.lockMetadataId
  ) {
    return apiError("Atomic launch does not match its reviewed intent", 422);
  }
  const config = intent.config;

  let verified;
  let metadata;
  try {
    verified = await verifyFinalizedAtomicLaunchTransaction(
      body.atomicTxSignature,
      session.wallet_address,
      body.mintAddress,
      body.lockMetadataId,
      {
        name: config.name,
        symbol: config.ticker,
        metadataUri: intent.metadataUri,
        buyAmountSol: config.buyAmountSol,
        quotedTokenAmount: intent.quotedTokenAmount,
        maxQuoteAmount: intent.maxQuoteAmount,
        lookupTableAddress: intent.altAddress,
        lookupTableAddresses: intent.altAddresses,
        lockAmount: intent.lockAmount,
        unlockTimestamp: intent.unlockTimestamp,
        lockDurationDays: config.lockDurationDays,
        lockPercentage: config.lockPercentage,
      },
    );
    metadata = await fetchApprovedMetadata(verified.metadataUri);
  } catch (error) {
    return verificationError(error);
  }

  if (
    metadata.name !== verified.name ||
    metadata.symbol !== verified.symbol ||
    metadata.description !== config.description ||
    metadata.image !== intent.imageUri ||
    (metadata.twitter ?? null) !== config.twitterUrl ||
    (metadata.telegram ?? null) !== config.telegramUrl ||
    (metadata.website ?? null) !== config.websiteUrl ||
    config.githubUsername !== session.github_username
  ) {
    return apiError("Finalized atomic metadata does not match the reviewed intent", 422);
  }

  const verifiedAt = new Date().toISOString();
  const { data: wasUpdated, error } = await serverClient.rpc(
    "record_verified_atomic_launch",
    {
      p_github_id: session.github_id,
      p_creator_wallet: session.wallet_address,
      p_mint_address: body.mintAddress,
      p_metadata_uri: verified.metadataUri,
      p_atomic_tx: verified.signature,
      p_lock_metadata_id: verified.metadataAddress,
      p_name: verified.name,
      p_ticker: verified.symbol,
      p_description: metadata.description,
      p_image_uri: metadata.image,
      p_lock_duration_days: verified.lock.durationDays,
      p_lock_percentage: verified.lock.percentage,
      p_lock_unlock_at: verified.lock.unlockAt,
      p_lock_amount: verified.lock.amount,
      p_lock_debited_amount: verified.lock.debitedAmount,
      p_purchased_amount: verified.purchasedAmount.toString(),
      p_buy_amount_sol: Number(verified.buyAmountLamports) / 1_000_000_000,
      p_github_username: session.github_username,
      p_github_repo: config.githubRepo,
      p_live_url: config.liveUrl,
      p_twitter_url: metadata.twitter ?? null,
      p_telegram_url: metadata.telegram ?? null,
      p_website_url: metadata.website ?? null,
      p_verified_at: verifiedAt,
      p_expected_state_version: intent.stateVersion,
    },
  );
  if (error) return persistenceError(error);
  const result = atomicRecordResultSchema.safeParse(wasUpdated);
  if (!result.success) return apiError("Atomic launch persistence returned an invalid state", 503);

  // Finalized lock is now persisted: enqueue a trust attestation (SAS_ENABLED
  // gated, non-blocking). Never fails the record request.
  await triggerFinalizedLockAttestation({
    mint: body.mintAddress,
    creator: session.wallet_address,
    streamId: verified.metadataAddress,
    lockedAmount: BigInt(verified.lock.amount),
    supplyBasis: verified.purchasedAmount,
    cliffTs: BigInt(Math.floor(new Date(verified.lock.unlockAt).getTime() / 1000)),
    github: session.github_username ?? "",
  });

  const responseStatus = result.data.replayed || result.data.updated ? 200 : 201;
  return apiResponse(
    {
      success: true,
      status: result.data.status,
      stateVersion: result.data.stateVersion,
      altStatus: result.data.altStatus,
      altStateVersion: result.data.altStateVersion,
      updated: result.data.updated,
      replayed: result.data.replayed,
    },
    responseStatus,
  );
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const limited = await checkRateLimit(request, "record");
  if (limited) return limited;

  const { session, error: authError } = await requireLinkedWallet();
  if (authError) return authError;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError("Invalid JSON", 400);
  }

  const parsed = atomicRecordSchema.safeParse(raw);
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);
  return recordAtomicLaunch(parsed.data, session);
}
