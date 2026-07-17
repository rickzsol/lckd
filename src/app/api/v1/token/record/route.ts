import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { requireLinkedWallet } from "@/lib/api/auth";
import { requireSameOrigin } from "@/lib/api/origin";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { getServerClient } from "@/lib/supabase";
import { isValidSolanaAddress } from "@/lib/api/validation";
import {
  OnChainVerificationError,
  verifyFinalizedLaunchTransaction,
  verifyFinalizedLockTransaction,
} from "@/lib/api/onchain";
import { fetchApprovedMetadata } from "@/lib/api/finalizedMetadata";
import { hasRequiredLockCoverage } from "@/lib/api/launchRecoveryValidation";

export { OPTIONS };

const solanaAddress = z.string().refine(isValidSolanaAddress, "Invalid Solana address");
const transactionSignature = z.string().min(64).max(90);
const httpsUrl = z.string().url().max(500).refine(
  (value) => new URL(value).protocol === "https:",
  "URL must use HTTPS",
);
const nullableUrl = httpsUrl.nullable().default(null);

const fullRecordSchema = z.object({
  mintAddress: solanaAddress,
  name: z.string().trim().min(1).max(32),
  ticker: z.string().trim().min(1).max(13),
  description: z.string().max(1000).default(""),
  imageUri: httpsUrl,
  creatorWallet: solanaAddress,
  launchTxSignature: transactionSignature,
  lockTxSignature: transactionSignature,
  lockDurationDays: z.number().int().min(7).max(365),
  lockPercentage: z.number().int().min(51).max(100),
  lockAmount: z.string().regex(/^\d+$/),
  buyAmountSol: z.number().finite().positive().max(100),
  githubUsername: z.string().nullable().default(null),
  githubRepo: z.string().max(200).nullable().default(null),
  liveUrl: nullableUrl,
  twitterUrl: nullableUrl,
  telegramUrl: nullableUrl,
  websiteUrl: nullableUrl,
}).strict();

function verificationError(error: unknown) {
  if (error instanceof OnChainVerificationError) {
    return apiError(error.message, error.status);
  }
  console.error("[token/record] On-chain verification failed:", error);
  return apiError("On-chain verification is unavailable", 503);
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

  const parsed = fullRecordSchema.safeParse(raw);
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);

  const body = parsed.data;
  if (body.creatorWallet !== session.wallet_address) {
    return apiError("creatorWallet does not match the linked wallet", 403);
  }
  if (body.githubUsername && body.githubUsername !== session.github_username) {
    return apiError("githubUsername does not match the authenticated user", 403);
  }
  if (body.launchTxSignature === body.lockTxSignature) {
    return apiError("Launch and lock transactions must be different", 400);
  }

  let launch;
  let lock;
  let metadata;
  try {
    launch = await verifyFinalizedLaunchTransaction(
      body.launchTxSignature,
      session.wallet_address,
      body.mintAddress,
    );
    metadata = await fetchApprovedMetadata(launch.metadataUri);
    lock = await verifyFinalizedLockTransaction(
      body.lockTxSignature,
      session.wallet_address,
      body.mintAddress,
      launch.purchasedAmount,
    );
  } catch (error) {
    return verificationError(error);
  }

  if (
    lock.durationDays !== body.lockDurationDays ||
    lock.percentage < 50
  ) {
    return apiError("Submitted lock terms do not match the finalized transaction", 422);
  }
  if (
    launch.name !== body.name ||
    launch.symbol !== body.ticker ||
    metadata.name !== launch.name ||
    metadata.symbol !== launch.symbol ||
    metadata.description !== body.description ||
    metadata.image !== body.imageUri ||
    (metadata.twitter ?? null) !== body.twitterUrl ||
    (metadata.telegram ?? null) !== body.telegramUrl ||
    (metadata.website ?? null) !== body.websiteUrl
  ) {
    return apiError("Submitted token details do not match finalized metadata", 422);
  }

  const { data: intent, error: intentError } = await getServerClient()
    .from("launch_intents")
    .select("status, create_tx, lock_tx, config")
    .eq("github_id", session.github_id)
    .eq("creator_wallet", session.wallet_address)
    .eq("mint_address", body.mintAddress)
    .maybeSingle();
  const requestedLockPercentage = Number(intent?.config?.lockPercentage);
  if (intentError) return apiError("Launch recovery is unavailable", 503);
  if (
    !intent ||
    intent.status !== "lock_submitted" ||
    intent.create_tx !== body.launchTxSignature ||
    intent.lock_tx !== body.lockTxSignature ||
    !hasRequiredLockCoverage(
      lock.debitedAmount,
      launch.purchasedAmount,
      requestedLockPercentage,
    )
  ) {
    return apiError("Finalized lock does not satisfy the reviewed launch intent", 422);
  }

  const verifiedAt = new Date().toISOString();
  const { data: wasUpdated, error } = await getServerClient().rpc(
    "record_verified_launch",
    {
      p_github_id: session.github_id,
      p_creator_wallet: session.wallet_address,
      p_mint_address: body.mintAddress,
      p_metadata_uri: launch.metadataUri,
      p_launch_tx: body.launchTxSignature,
      p_lock_tx: body.lockTxSignature,
      p_name: launch.name,
      p_ticker: launch.symbol,
      p_description: metadata.description,
      p_image_uri: metadata.image,
      p_lock_duration_days: lock.durationDays,
      p_lock_percentage: lock.percentage,
      p_lock_unlock_at: lock.unlockAt,
      p_lock_amount: lock.amount,
      p_lock_debited_amount: lock.debitedAmount,
      p_purchased_amount: launch.purchasedAmount.toString(),
      p_buy_amount_sol: Number(launch.buyAmountLamports) / 1_000_000_000,
      p_github_username: session.github_username,
      p_github_repo: body.githubRepo,
      p_live_url: body.liveUrl,
      p_twitter_url: metadata.twitter ?? null,
      p_telegram_url: metadata.telegram ?? null,
      p_website_url: metadata.website ?? null,
      p_verified_at: verifiedAt,
    },
  );
  if (error) {
    console.error("[token/record] Persistence failed:", error.message);
    const isConflict = error.code === "23505" || error.code === "23514";
    return apiError(
      isConflict ? "Launch recovery state does not match finalized receipts" : "Failed to record token",
      isConflict ? 409 : 503,
    );
  }
  return apiResponse({ success: true, updated: wasUpdated === true }, wasUpdated ? 200 : 201);
}
