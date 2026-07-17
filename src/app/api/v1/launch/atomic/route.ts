import { type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { apiError, apiResponse, OPTIONS } from "@/lib/api/helpers";
import { requireLinkedWallet } from "@/lib/api/auth";
import { requireSameOrigin } from "@/lib/api/origin";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { isValidSolanaAddress } from "@/lib/api/validation";
import {
  AtomicLaunchRecoveryError,
  getOwnedAtomicLaunchIntent,
  issueAtomicTransaction,
} from "@/lib/api/atomicLaunchRecovery";
import {
  buildAtomicLaunchTransaction,
  freezeAtomicLaunchConfig,
} from "@/lib/solana/atomicLaunchBuilder.server";

export { OPTIONS };

const address = z.string().refine(isValidSolanaAddress, "Invalid Solana address");
const requestSchema = z.object({
  mintPublicKey: address,
  metadataPublicKey: address,
}).strict();
const nullableHttpsUrl = z.string().url().max(500).refine(
  (value) => new URL(value).protocol === "https:",
  "URL must use HTTPS",
).nullable();
const configSchema = z.object({
  name: z.string().trim().min(1).max(32),
  ticker: z.string().trim().min(1).max(13),
  description: z.string().max(1000),
  buyAmountSol: z.number().finite().min(0.01).max(100),
  lockDurationDays: z.number().int().min(7).max(365),
  lockPercentage: z.number().int().min(51).max(99),
  githubUsername: z.string().min(1).max(39),
  githubRepo: z.string().max(200).nullable(),
  liveUrl: nullableHttpsUrl,
  twitterUrl: nullableHttpsUrl,
  telegramUrl: nullableHttpsUrl,
  websiteUrl: nullableHttpsUrl,
}).strict();
const intentSchema = z.object({
  status: z.string(),
  stateVersion: z.number().int().nonnegative(),
  altStatus: z.string(),
  altStateVersion: z.number().int().nonnegative(),
  creatorWallet: address,
  mintAddress: address,
  metadataAddress: address,
  metadataUri: z.string().url(),
  config: configSchema,
  altAddress: address,
  altAddresses: z.array(address).min(1).max(256),
  altAddressesHash: z.string().regex(/^[0-9a-f]{64}$/),
  quotedTokenAmount: z.string().regex(/^\d+$/),
  maxQuoteAmount: z.string().regex(/^\d+$/),
}).passthrough();

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await checkRateLimit(request, "launch");
  if (limited) return limited;
  const { session, error: authError } = await requireLinkedWallet();
  if (authError) return authError;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);

  let snapshot;
  try {
    snapshot = await getOwnedAtomicLaunchIntent({
      githubId: session.github_id,
      creatorWallet: session.wallet_address,
      mintAddress: parsed.data.mintPublicKey,
    });
  } catch (error) {
    if (error instanceof AtomicLaunchRecoveryError) return apiError(error.message, error.status);
    return apiError("Atomic launch recovery is unavailable", 503);
  }
  const intentResult = intentSchema.safeParse(snapshot);
  if (!intentResult.success) return apiError("Atomic launch intent was not found", 404);
  const intent = intentResult.data;
  if (
    intent.status !== "alt_ready" ||
    intent.altStatus !== "ready" ||
    intent.creatorWallet !== session.wallet_address ||
    intent.mintAddress !== parsed.data.mintPublicKey ||
    intent.metadataAddress !== parsed.data.metadataPublicKey
  ) {
    return apiError("Atomic launch is not ready for construction", 409);
  }

  try {
    const bundle = await buildAtomicLaunchTransaction({
      walletPublicKey: new PublicKey(intent.creatorWallet),
      mintPublicKey: new PublicKey(intent.mintAddress),
      metadataPublicKey: new PublicKey(intent.metadataAddress),
      metadataUri: intent.metadataUri,
      config: freezeAtomicLaunchConfig(intent.config),
    }, new PublicKey(intent.altAddress));
    if (
      bundle.addressHash !== intent.altAddressesHash ||
      bundle.lookupTableAddress.toBase58() !== intent.altAddress ||
      bundle.quotedTokenAmount !== intent.quotedTokenAmount ||
      bundle.maxQuoteAmount !== intent.maxQuoteAmount
    ) {
      return apiError("Atomic transaction does not match the immutable launch intent", 422);
    }
    const issued = await issueAtomicTransaction({
      githubId: session.github_id,
      creatorWallet: session.wallet_address,
      mintAddress: intent.mintAddress,
      expectedStateVersion: intent.stateVersion,
      quotedTokenAmount: bundle.quotedTokenAmount,
      maxQuoteAmount: bundle.maxQuoteAmount,
      messageHash: bundle.messageHash,
      blockhash: bundle.blockhash,
      lastValidBlockHeight: bundle.lastValidBlockHeight,
      lockAmount: bundle.lockAmount,
      unlockTimestamp: bundle.unlockTimestamp,
    });
    return apiResponse({
      transaction: Buffer.from(bundle.txBytes).toString("base64"),
      mintPublicKey: intent.mintAddress,
      metadataPublicKey: intent.metadataAddress,
      lookupTableAddress: bundle.lookupTableAddress.toBase58(),
      lookupAddresses: intent.altAddresses,
      lookupAddressesHash: bundle.addressHash,
      blockhash: bundle.blockhash,
      lastValidBlockHeight: bundle.lastValidBlockHeight,
      quotedTokenAmount: bundle.quotedTokenAmount,
      maxQuoteAmount: bundle.maxQuoteAmount,
      lockAmount: bundle.lockAmount,
      unlockTimestamp: bundle.unlockTimestamp,
      streamflowFeePercent: bundle.streamflowFeePercent,
      stateVersion: issued.stateVersion,
      altStateVersion: issued.altStateVersion,
    });
  } catch (buildError) {
    console.error("[launch/atomic] Failed:", buildError);
    return apiError("Atomic launch construction is unavailable", 503);
  }
}
