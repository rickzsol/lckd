import { type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { apiError, apiResponse, OPTIONS } from "@/lib/api/helpers";
import { requireLinkedWallet } from "@/lib/api/auth";
import { requireSameOrigin } from "@/lib/api/origin";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { fetchApprovedMetadata } from "@/lib/api/finalizedMetadata";
import { isValidSolanaAddress } from "@/lib/api/validation";
import {
  AtomicLaunchRecoveryError,
  getOwnedAtomicLaunchIntent,
  prepareAtomicLaunchIntent,
} from "@/lib/api/atomicLaunchRecovery";
import {
  buildAtomicLookupPreparation,
  freezeAtomicLaunchConfig,
  rebuildIssuedAtomicLookupPreparation,
  type AtomicLaunchIdentity,
} from "@/lib/solana/atomicLaunchBuilder.server";
import type { AtomicIntentSnapshot } from "@/lib/api/atomicLaunchRecoveryValidation";

export { OPTIONS };

const address = z.string().refine(isValidSolanaAddress, "Invalid Solana address");
const httpsUrl = z.string().url().max(500).refine(
  (value) => new URL(value).protocol === "https:",
  "URL must use HTTPS",
);
const nullableHttpsUrl = httpsUrl.nullable().optional();
const launchSchema = z.object({
  walletPublicKey: address,
  mintPublicKey: address,
  metadataPublicKey: address,
  metadataUri: httpsUrl.max(200),
  imageUri: httpsUrl,
  name: z.string().trim().min(1).max(32),
  ticker: z.string().trim().min(1).max(13),
  description: z.string().max(1000).default(""),
  buyAmountSol: z.number().finite().min(0.01).max(100),
  lockDurationDays: z.number().int().min(7).max(365),
  lockPercentage: z.number().int().min(51).max(99),
  githubUsername: z.string().max(39).nullable().optional(),
  githubRepo: z.string().max(200).nullable().optional(),
  liveUrl: nullableHttpsUrl,
  twitterUrl: nullableHttpsUrl,
  telegramUrl: nullableHttpsUrl,
  websiteUrl: nullableHttpsUrl,
}).strict();

async function restorePersistedSetup(
  identity: AtomicLaunchIdentity,
  persisted: AtomicIntentSnapshot,
) {
  if (
    persisted.issuedSetupTransaction === null ||
    persisted.issuedSetupRecentSlot === null ||
    persisted.plannedLockAmount === null ||
    persisted.plannedUnlockTimestamp === null ||
    persisted.plannedStreamflowFeePercent === null
  ) {
    throw new AtomicLaunchRecoveryError("Prepared launch issuance is incomplete", 422);
  }
  return rebuildIssuedAtomicLookupPreparation(identity, {
    transaction: Buffer.from(persisted.issuedSetupTransaction, "base64"),
    lookupTableAddress: new PublicKey(persisted.altAddress),
    addresses: persisted.altAddresses.map((value) => new PublicKey(value)),
    recentSlot: persisted.issuedSetupRecentSlot,
    messageHash: persisted.issuedSetupMessageHash,
    blockhash: persisted.issuedSetupBlockhash,
    lastValidBlockHeight: persisted.issuedSetupLastValidBlockHeight,
    plan: {
      quotedTokenAmount: persisted.quotedTokenAmount,
      maxQuoteAmount: persisted.maxQuoteAmount,
      lockAmount: persisted.plannedLockAmount,
      unlockTimestamp: persisted.plannedUnlockTimestamp,
      streamflowFeePercent: persisted.plannedStreamflowFeePercent,
    },
  });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await checkRateLimit(request, "launch");
  if (limited) return limited;
  const { session, error: authError } = await requireLinkedWallet();
  if (authError) return authError;

  const parsed = launchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);
  const body = parsed.data;
  if (body.walletPublicKey !== session.wallet_address) {
    return apiError("walletPublicKey does not match the linked wallet", 403);
  }
  if (body.githubUsername && body.githubUsername !== session.github_username) {
    return apiError("githubUsername does not match the authenticated user", 403);
  }

  try {
    const metadata = await fetchApprovedMetadata(body.metadataUri);
    if (
      metadata.name !== body.name ||
      metadata.symbol !== body.ticker ||
      metadata.description !== body.description ||
      metadata.image !== body.imageUri ||
      (metadata.twitter ?? null) !== (body.twitterUrl ?? null) ||
      (metadata.telegram ?? null) !== (body.telegramUrl ?? null) ||
      (metadata.website ?? null) !== (body.websiteUrl ?? null)
    ) {
      return apiError("Launch details do not match the approved metadata", 422);
    }

    const walletPublicKey = new PublicKey(body.walletPublicKey);
    const mintPublicKey = new PublicKey(body.mintPublicKey);
    const metadataPublicKey = new PublicKey(body.metadataPublicKey);
    const frozenConfig = freezeAtomicLaunchConfig(body);
    const identity = {
      walletPublicKey,
      mintPublicKey,
      metadataPublicKey,
      metadataUri: body.metadataUri,
      config: frozenConfig,
    };
    const config = {
      name: body.name,
      ticker: body.ticker,
      description: body.description,
      buyAmountSol: body.buyAmountSol,
      lockDurationDays: body.lockDurationDays,
      lockPercentage: body.lockPercentage,
      githubUsername: session.github_username,
      githubRepo: body.githubRepo ?? null,
      liveUrl: body.liveUrl ?? null,
      twitterUrl: body.twitterUrl ?? null,
      telegramUrl: body.telegramUrl ?? null,
      websiteUrl: body.websiteUrl ?? null,
    };
    const existing = await getOwnedAtomicLaunchIntent({
      githubId: session.github_id,
      creatorWallet: session.wallet_address,
      mintAddress: body.mintPublicKey,
    });
    if (existing && existing.status !== "prepared") {
      throw new AtomicLaunchRecoveryError("Atomic launch setup is already past preparation", 409);
    }
    const setup = existing
      ? await restorePersistedSetup(identity, existing)
      : await buildAtomicLookupPreparation(identity);
    const intent = await prepareAtomicLaunchIntent({
      githubId: session.github_id,
      creatorWallet: session.wallet_address,
      mintAddress: body.mintPublicKey,
      metadataAddress: body.metadataPublicKey,
      config,
      metadata: {
        metadataUri: body.metadataUri,
        imageUri: body.imageUri,
        name: body.name,
        ticker: body.ticker,
        description: body.description,
        twitterUrl: body.twitterUrl ?? null,
        telegramUrl: body.telegramUrl ?? null,
        websiteUrl: body.websiteUrl ?? null,
      },
      altAddress: setup.lookupTableAddress.toBase58(),
      altAddresses: setup.addresses.map((address) => address.toBase58()),
      quotedTokenAmount: setup.quotedTokenAmount,
      maxQuoteAmount: setup.maxQuoteAmount,
      setupMessageHash: setup.messageHash,
      setupBlockhash: setup.blockhash,
      setupLastValidBlockHeight: setup.lastValidBlockHeight,
      issuedSetupRecentSlot: setup.recentSlot,
      issuedSetupTransaction: Buffer.from(setup.transaction).toString("base64"),
      plannedLockAmount: setup.lockAmount,
      plannedUnlockTimestamp: setup.unlockTimestamp,
      plannedStreamflowFeePercent: setup.streamflowFeePercent,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });

    const persisted = await getOwnedAtomicLaunchIntent({
      githubId: session.github_id,
      creatorWallet: session.wallet_address,
      mintAddress: body.mintPublicKey,
    });
    if (!persisted) {
      throw new AtomicLaunchRecoveryError("Prepared launch state was not found", 409);
    }
    const responseSetup = await restorePersistedSetup(identity, persisted);

    return apiResponse({
      transaction: Buffer.from(responseSetup.transaction).toString("base64"),
      mintPublicKey: body.mintPublicKey,
      metadataPublicKey: body.metadataPublicKey,
      lookupTableAddress: responseSetup.lookupTableAddress.toBase58(),
      lookupAddresses: responseSetup.addresses.map((address) => address.toBase58()),
      lookupAddressesHash: responseSetup.addressHash,
      recentSlot: responseSetup.recentSlot,
      blockhash: responseSetup.blockhash,
      lastValidBlockHeight: responseSetup.lastValidBlockHeight,
      quotedTokenAmount: responseSetup.quotedTokenAmount,
      maxQuoteAmount: responseSetup.maxQuoteAmount,
      lockAmount: responseSetup.lockAmount,
      unlockTimestamp: responseSetup.unlockTimestamp,
      streamflowFeePercent: responseSetup.streamflowFeePercent,
      status: intent.status,
      stateVersion: intent.stateVersion,
      altStatus: intent.altStatus,
      altStateVersion: intent.altStateVersion,
    }, intent.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof AtomicLaunchRecoveryError) {
      return apiError(error.message, error.status);
    }
    console.error("[launch/atomic-setup] Failed:", error);
    return apiError("Atomic launch setup is unavailable", 503);
  }
}
