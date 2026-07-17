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
import {
  completeLaunchIntent,
  LaunchRecoveryError,
} from "@/lib/api/launchRecovery";

export { OPTIONS };

const solanaAddress = z.string().refine(isValidSolanaAddress, "Invalid Solana address");
const transactionSignature = z.string().min(64).max(90);
const httpsUrl = z.string().url().max(500).refine(
  (value) => new URL(value).protocol === "https:",
  "URL must use HTTPS",
);
const nullableUrl = httpsUrl.nullable().default(null);
const MAX_METADATA_BYTES = 16 * 1024;

const finalizedMetadataSchema = z.object({
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(13),
  description: z.string().max(1000).default(""),
  image: httpsUrl,
  twitter: nullableUrl.optional(),
  telegram: nullableUrl.optional(),
  website: nullableUrl.optional(),
}).passthrough();

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

function pinataGatewayOrigin(): string {
  const configured = process.env.PINATA_GATEWAY?.trim();
  if (!configured) return "https://gateway.pinata.cloud";
  const gateway = new URL(configured.startsWith("http") ? configured : `https://${configured}`);
  const isApprovedHost =
    gateway.hostname === "gateway.pinata.cloud" ||
    gateway.hostname.endsWith(".mypinata.cloud");
  if (gateway.protocol !== "https:" || !isApprovedHost) {
    throw new OnChainVerificationError("PINATA_GATEWAY is not an approved Pinata host", 503);
  }
  return gateway.origin;
}

async function readLimitedBody(response: Response): Promise<string> {
  if (!response.body) {
    throw new OnChainVerificationError("Finalized launch metadata has no body", 422);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_METADATA_BYTES) {
      await reader.cancel();
      throw new OnChainVerificationError("Finalized launch metadata is too large", 422);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchFinalizedMetadata(metadataUri: string) {
  const url = new URL(metadataUri);
  if (
    url.protocol !== "https:" ||
    url.origin !== pinataGatewayOrigin() ||
    !/^\/ipfs\/[A-Za-z0-9]+$/.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new OnChainVerificationError("Launch metadata URI is not an approved IPFS gateway URL", 422);
  }

  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new OnChainVerificationError("Finalized launch metadata is unavailable", 422);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_METADATA_BYTES) {
    throw new OnChainVerificationError("Finalized launch metadata is too large", 422);
  }
  const text = await readLimitedBody(response);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new OnChainVerificationError("Finalized launch metadata is invalid JSON", 422);
  }
  const parsed = finalizedMetadataSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OnChainVerificationError("Finalized launch metadata is invalid", 422);
  }
  return parsed.data;
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
    metadata = await fetchFinalizedMetadata(launch.metadataUri);
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
    lock.percentage < 50 ||
    lock.percentage > body.lockPercentage ||
    BigInt(lock.debitedAmount) + BigInt(10) <
      (launch.purchasedAmount * BigInt(body.lockPercentage)) / BigInt(100)
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

  const supabase = getServerClient();
  const { data: existing, error: lookupError } = await supabase
    .from("tokens")
    .select("id, creator_wallet, launch_tx")
    .eq("mint_address", body.mintAddress)
    .maybeSingle();

  if (lookupError) {
    console.error("[token/record] Token lookup failed:", lookupError.message);
    return apiError("Failed to verify token ownership", 503);
  }
  if (existing?.creator_wallet && existing.creator_wallet !== session.wallet_address) {
    return apiError("Token is owned by another wallet", 403);
  }
  if (existing?.launch_tx && existing.launch_tx !== body.launchTxSignature) {
    return apiError("Launch transaction cannot be replaced", 409);
  }

  const verifiedAt = new Date().toISOString();
  const values = {
    name: launch.name,
    ticker: launch.symbol,
    description: metadata.description,
    image_uri: metadata.image,
    creator_wallet: session.wallet_address,
    launch_tx: body.launchTxSignature,
    lock_tx: body.lockTxSignature,
    lock_duration_days: lock.durationDays,
    lock_percentage: lock.percentage,
    lock_unlock_at: lock.unlockAt,
    lock_amount: lock.amount,
    buy_amount_sol: Number(launch.buyAmountLamports) / 1_000_000_000,
    github_username: session.github_username,
    github_repo: body.githubRepo,
    live_url: body.liveUrl,
    twitter_url: metadata.twitter ?? null,
    telegram_url: metadata.telegram ?? null,
    website_url: metadata.website ?? null,
    launch_verified_at: verifiedAt,
    lock_verified_at: verifiedAt,
  };

  const query = existing
    ? supabase
        .from("tokens")
        .update(values)
        .eq("id", existing.id)
        .eq("creator_wallet", session.wallet_address)
    : supabase.from("tokens").insert({
        ...values,
        mint_address: body.mintAddress,
        trust_tier: 1,
      });

  const { data, error } = await query.select("id").maybeSingle();
  if (error) {
    console.error("[token/record] Persistence failed:", error.message);
    return apiError(error.code === "23505" ? "Token or transaction is already recorded" : "Failed to record token", error.code === "23505" ? 409 : 503);
  }
  if (!data) return apiError("Token ownership changed during update", 409);

  try {
    await completeLaunchIntent(session, body.mintAddress);
  } catch (completionError) {
    if (completionError instanceof LaunchRecoveryError) {
      return apiError(completionError.message, completionError.status);
    }
    return apiError("Failed to complete launch recovery state", 503);
  }

  return apiResponse({ success: true, updated: Boolean(existing) }, existing ? 200 : 201);
}
