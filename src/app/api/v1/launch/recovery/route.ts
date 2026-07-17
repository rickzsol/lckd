import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiResponse, OPTIONS } from "@/lib/api/helpers";
import { requireLinkedWallet, type LinkedWalletSession } from "@/lib/api/auth";
import { requireSameOrigin } from "@/lib/api/origin";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { getServerClient } from "@/lib/supabase";
import { isValidSolanaAddress } from "@/lib/api/validation";
import {
  OnChainVerificationError,
  getFinalizedBlockHeight,
  verifyFinalizedLaunchTransaction,
} from "@/lib/api/onchain";

export { OPTIONS };

const signature = z.string().min(64).max(90);
const address = z.string().refine(isValidSolanaAddress, "Invalid Solana address");
const checkpointSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("create_submitted"),
    mintAddress: address,
    createTxSignature: signature,
    createBlockhash: z.string().min(32).max(64),
    createLastValidBlockHeight: z.number().int().positive(),
  }).strict(),
  z.object({
    phase: z.literal("create_finalized"),
    mintAddress: address,
    createTxSignature: signature,
  }).strict(),
  z.object({
    phase: z.literal("lock_submitted"),
    mintAddress: address,
    lockTxSignature: signature,
    lockMetadataId: address,
    lockAmount: z.string().regex(/^\d+$/),
    unlockTimestamp: z.number().int().positive(),
    lockBlockhash: z.string().min(32).max(64),
    lockLastValidBlockHeight: z.number().int().positive(),
    replacesLockTxSignature: signature.nullable().optional(),
  }).strict(),
]);
const abandonSchema = z.object({ mintAddress: address }).strict();

type IntentRow = {
  id: string;
  github_id: string;
  creator_wallet: string;
  mint_address: string;
  metadata_uri: string;
  image_uri: string;
  config: Record<string, unknown>;
  create_tx: string | null;
  create_blockhash: string | null;
  create_last_valid_block_height: number | null;
  lock_tx: string | null;
  lock_metadata_id: string | null;
  lock_amount: string | null;
  unlock_timestamp: number | null;
  lock_blockhash: string | null;
  lock_last_valid_block_height: number | null;
  status: string;
};

async function getOwnedIntent(session: LinkedWalletSession, mint?: string) {
  let query = getServerClient()
    .from("launch_intents")
    .select("*")
    .eq("github_id", session.github_id)
    .eq("creator_wallet", session.wallet_address)
    .in("status", ["prepared", "create_submitted", "create_finalized", "lock_submitted"]);
  if (mint) query = query.eq("mint_address", mint);
  else query = query.gt("expires_at", new Date().toISOString()).order("updated_at", { ascending: false }).limit(1);
  return query.maybeSingle<IntentRow>();
}

async function verifyIntentLaunch(row: IntentRow) {
  if (!row.create_tx) throw new OnChainVerificationError("Creation signature is missing", 409);
  const launch = await verifyFinalizedLaunchTransaction(
    row.create_tx,
    row.creator_wallet,
    row.mint_address,
  );
  const requestedBuySol = Number(row.config.buyAmountSol);
  if (!Number.isFinite(requestedBuySol) || requestedBuySol <= 0) {
    throw new OnChainVerificationError("Recovery buy configuration is invalid", 422);
  }
  const maxBuyLamports = BigInt(Math.ceil(requestedBuySol * 1_000_000_000 * 1.10));
  if (
    launch.metadataUri !== row.metadata_uri ||
    launch.name !== row.config.name ||
    launch.symbol !== row.config.ticker ||
    launch.buyAmountLamports > maxBuyLamports
  ) {
    throw new OnChainVerificationError("Creation does not match recovery state", 422);
  }
  return launch;
}

async function markCreateFinalized(row: IntentRow): Promise<IntentRow> {
  await verifyIntentLaunch(row);
  if (row.status === "create_finalized" || row.status === "lock_submitted") return row;
  const { data, error } = await getServerClient().rpc("checkpoint_create_finalized", {
    p_github_id: row.github_id,
    p_creator_wallet: row.creator_wallet,
    p_mint_address: row.mint_address,
    p_create_tx: row.create_tx,
  });
  if (error || data !== true) throw new Error("Failed to reconcile launch recovery state");
  return { ...row, status: "create_finalized" };
}

function recoveryResponse(row: IntentRow) {
  return {
    status: row.status,
    canRetryLock: row.status === "create_finalized" || row.status === "lock_submitted",
    config: row.config,
    imageUri: row.image_uri,
    launchResult: {
      mintAddress: row.mint_address,
      createTxSignature: row.create_tx,
      lockTxSignature: row.lock_tx,
      lockMetadataId: row.lock_metadata_id,
      lockAmount: row.lock_amount ?? "",
      unlockTimestamp: row.unlock_timestamp,
      lockBlockhash: row.lock_blockhash,
      lockLastValidBlockHeight: row.lock_last_valid_block_height,
    },
  };
}

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, "launch");
  if (limited) return limited;
  const { session, error: authError } = await requireLinkedWallet();
  if (authError) return authError;

  const { data, error } = await getOwnedIntent(session);
  if (error) return apiError("Launch recovery is unavailable", 503);
  if (!data) return apiResponse({ intent: null });

  let row = data;
  if (row.status === "create_submitted") {
    try {
      row = await markCreateFinalized(row);
    } catch (error) {
      if (!(error instanceof OnChainVerificationError) || error.status !== 409) {
        console.error("[launch/recovery] Reconciliation failed:", error);
      }
    }
  }
  return apiResponse({ intent: recoveryResponse(row) });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await checkRateLimit(request, "launch");
  if (limited) return limited;

  const { session, error: authError } = await requireLinkedWallet();
  if (authError) return authError;
  const parsed = checkpointSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);

  const body = parsed.data;
  const { data: row, error } = await getOwnedIntent(session, body.mintAddress);
  if (error) return apiError("Launch recovery is unavailable", 503);
  if (!row) return apiError("Launch recovery state was not found", 404);

  if (body.phase === "create_submitted") {
    const { data, error: updateError } = await getServerClient().rpc(
      "checkpoint_create_submitted",
      {
        p_github_id: session.github_id,
        p_creator_wallet: session.wallet_address,
        p_mint_address: body.mintAddress,
        p_create_tx: body.createTxSignature,
        p_create_blockhash: body.createBlockhash,
        p_create_last_valid_block_height: body.createLastValidBlockHeight,
      },
    );
    if (updateError) return apiError("Failed to save creation checkpoint", 503);
    return data === true
      ? apiResponse({ success: true })
      : apiError("Creation checkpoint is out of order", 409);
  }

  if (body.phase === "create_finalized") {
    if (row.create_tx !== body.createTxSignature) {
      return apiError("Creation signature does not match recovery state", 409);
    }
    try {
      await markCreateFinalized(row);
      return apiResponse({ success: true });
    } catch (verificationError) {
      if (verificationError instanceof OnChainVerificationError) {
        return apiError(verificationError.message, verificationError.status);
      }
      return apiError("Failed to verify creation checkpoint", 503);
    }
  }

  if (row.status !== "create_finalized" && row.status !== "lock_submitted") {
    return apiError("Lock checkpoint is out of order", 409);
  }
  if (body.lockTxSignature === row.create_tx) {
    return apiError("Creation and lock signatures must differ", 400);
  }
  const { data, error: updateError } = await getServerClient().rpc(
    "checkpoint_lock_submitted",
    {
      p_github_id: session.github_id,
      p_creator_wallet: session.wallet_address,
      p_mint_address: body.mintAddress,
      p_previous_lock_tx: body.replacesLockTxSignature ?? null,
      p_lock_tx: body.lockTxSignature,
      p_lock_metadata_id: body.lockMetadataId,
      p_lock_amount: body.lockAmount,
      p_unlock_timestamp: body.unlockTimestamp,
      p_lock_blockhash: body.lockBlockhash,
      p_lock_last_valid_block_height: body.lockLastValidBlockHeight,
    },
  );
  if (updateError) return apiError("Failed to save lock checkpoint", 503);
  return data === true
    ? apiResponse({ success: true })
    : apiError("Lock checkpoint is stale", 409);
}

export async function DELETE(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await checkRateLimit(request, "launch");
  if (limited) return limited;

  const { session, error: authError } = await requireLinkedWallet();
  if (authError) return authError;
  const parsed = abandonSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);

  const { data: row, error } = await getOwnedIntent(session, parsed.data.mintAddress);
  if (error) return apiError("Launch recovery is unavailable", 503);
  if (!row) return apiResponse({ success: true });
  if (row.status === "create_finalized" || row.status === "lock_submitted") {
    return apiError("A finalized creation cannot abandon its mandatory lock", 409);
  }

  if (row.status === "create_submitted") {
    try {
      await markCreateFinalized(row);
      return apiError("A finalized creation cannot abandon its mandatory lock", 409);
    } catch (verificationError) {
      if (
        verificationError instanceof OnChainVerificationError &&
        verificationError.status !== 409 &&
        verificationError.message !== "Transaction failed on-chain"
      ) {
        return apiError(verificationError.message, verificationError.status);
      }
    }
    if (
      !row.create_last_valid_block_height ||
      await getFinalizedBlockHeight() <= row.create_last_valid_block_height
    ) {
      return apiError("Creation may still land; retry after its blockhash expires", 409);
    }
  }

  const { data, error: updateError } = await getServerClient()
    .from("launch_intents")
    .update({ status: "abandoned", updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", row.status)
    .select("id")
    .maybeSingle();
  if (updateError || !data) return apiError("Launch recovery state changed", 409);
  return apiResponse({ success: true });
}
