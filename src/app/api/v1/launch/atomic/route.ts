import { type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { apiError, apiResponse, OPTIONS } from "@/lib/api/helpers";
import { requireLaunchCreationAccess } from "@/lib/api/launchAccess";
import { requireSameOrigin } from "@/lib/api/origin";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { isValidSolanaAddress } from "@/lib/api/validation";
import {
  AtomicLaunchRecoveryError,
  getOwnedAtomicLaunchIntent,
  issueAtomicTransaction,
} from "@/lib/api/atomicLaunchRecovery";
import { hashOrderedAddresses } from "@/lib/api/atomicLaunchRecoveryValidation";
import {
  buildAtomicLaunchTransaction,
  freezeAtomicLaunchConfig,
  type AtomicLaunchPlanSnapshot,
  type IssuedAtomicLaunchTransaction,
} from "@/lib/solana/atomicLaunchBuilder.server";
import { hashLookupAddresses } from "@/lib/solana/lookupTable";

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
  plannedLockAmount: z.string().regex(/^\d+$/),
  plannedUnlockTimestamp: z.number().int().positive().safe(),
  plannedStreamflowFeePercent: z.number().finite().min(0).lt(100),
  issuedAtomicTransaction: z.string().min(100).max(2_000).nullable(),
  issuedAtomicMessageHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  issuedAtomicBlockhash: z.string().min(32).max(64).nullable(),
  issuedAtomicLastValidBlockHeight: z.number().int().positive().safe().nullable(),
}).passthrough();

function issuedAtomicTransaction(
  intent: z.infer<typeof intentSchema>,
): IssuedAtomicLaunchTransaction | undefined {
  const fields = [
    intent.issuedAtomicTransaction,
    intent.issuedAtomicMessageHash,
    intent.issuedAtomicBlockhash,
    intent.issuedAtomicLastValidBlockHeight,
  ];
  if (fields.every((value) => value === null)) return undefined;
  if (fields.some((value) => value === null)) {
    throw new AtomicLaunchRecoveryError("Issued atomic transaction is incomplete", 422);
  }
  return {
    transaction: Buffer.from(intent.issuedAtomicTransaction!, "base64"),
    messageHash: intent.issuedAtomicMessageHash!,
    blockhash: intent.issuedAtomicBlockhash!,
    lastValidBlockHeight: intent.issuedAtomicLastValidBlockHeight!,
  };
}

function frozenPlan(intent: z.infer<typeof intentSchema>): AtomicLaunchPlanSnapshot {
  return {
    quotedTokenAmount: intent.quotedTokenAmount,
    maxQuoteAmount: intent.maxQuoteAmount,
    lockAmount: intent.plannedLockAmount,
    unlockTimestamp: intent.plannedUnlockTimestamp,
    streamflowFeePercent: intent.plannedStreamflowFeePercent,
  };
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await checkRateLimit(request, "launch");
  if (limited) return limited;
  const { session, error: authError } = await requireLaunchCreationAccess();
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
    const identity = {
      walletPublicKey: new PublicKey(intent.creatorWallet),
      mintPublicKey: new PublicKey(intent.mintAddress),
      metadataPublicKey: new PublicKey(intent.metadataAddress),
      metadataUri: intent.metadataUri,
      config: freezeAtomicLaunchConfig(intent.config),
    };
    const bundle = await buildAtomicLaunchTransaction(
      identity,
      new PublicKey(intent.altAddress),
      frozenPlan(intent),
      issuedAtomicTransaction(intent),
    );
    const immutableLookupHash = hashLookupAddresses(
      intent.altAddresses.map((addressValue) => new PublicKey(addressValue)),
    );
    if (
      hashOrderedAddresses(intent.altAddresses) !== intent.altAddressesHash ||
      bundle.addressHash !== immutableLookupHash ||
      bundle.lookupTableAddress.toBase58() !== intent.altAddress ||
      bundle.quotedTokenAmount !== intent.quotedTokenAmount ||
      bundle.maxQuoteAmount !== intent.maxQuoteAmount
    ) {
      return apiError("Atomic transaction does not match the immutable launch intent", 422);
    }
    await issueAtomicTransaction({
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
      issuedAtomicTransaction: Buffer.from(bundle.txBytes).toString("base64"),
    });
    const persistedResult = intentSchema.safeParse(await getOwnedAtomicLaunchIntent({
      githubId: session.github_id,
      creatorWallet: session.wallet_address,
      mintAddress: intent.mintAddress,
    }));
    if (!persistedResult.success) {
      throw new AtomicLaunchRecoveryError("Issued atomic transaction was not persisted", 409);
    }
    const persisted = persistedResult.data;
    const responseBundle = await buildAtomicLaunchTransaction(
      identity,
      new PublicKey(persisted.altAddress),
      frozenPlan(persisted),
      issuedAtomicTransaction(persisted),
    );
    return apiResponse({
      transaction: Buffer.from(responseBundle.txBytes).toString("base64"),
      mintPublicKey: intent.mintAddress,
      metadataPublicKey: intent.metadataAddress,
      lookupTableAddress: responseBundle.lookupTableAddress.toBase58(),
      lookupAddresses: intent.altAddresses,
      lookupAddressesHash: responseBundle.addressHash,
      blockhash: responseBundle.blockhash,
      lastValidBlockHeight: responseBundle.lastValidBlockHeight,
      quotedTokenAmount: responseBundle.quotedTokenAmount,
      maxQuoteAmount: responseBundle.maxQuoteAmount,
      lockAmount: responseBundle.lockAmount,
      unlockTimestamp: responseBundle.unlockTimestamp,
      streamflowFeePercent: responseBundle.streamflowFeePercent,
      stateVersion: persisted.stateVersion,
      altStateVersion: persisted.altStateVersion,
    });
  } catch (buildError) {
    if (buildError instanceof AtomicLaunchRecoveryError) {
      return apiError(buildError.message, buildError.status);
    }
    console.error("[launch/atomic] Failed:", buildError);
    return apiError("Atomic launch construction is unavailable", 503);
  }
}
