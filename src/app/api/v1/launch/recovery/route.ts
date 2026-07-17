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
  verifyFinalizedLaunchTransaction,
} from "@/lib/api/onchain";

export { OPTIONS };

const signature = z.string().min(64).max(90);
const mintAddress = z.string().refine(isValidSolanaAddress, "Invalid mint address");
const checkpointSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("create_submitted"),
    mintAddress,
    createTxSignature: signature,
    createBlockhash: z.string().min(32).max(64),
    createLastValidBlockHeight: z.number().int().positive(),
  }).strict(),
  z.object({
    phase: z.literal("create_finalized"),
    mintAddress,
    createTxSignature: signature,
  }).strict(),
  z.object({
    phase: z.literal("lock_submitted"),
    mintAddress,
    lockTxSignature: signature,
    lockMetadataId: mintAddress,
    lockAmount: z.string().regex(/^\d+$/),
    unlockTimestamp: z.number().int().positive(),
    lockBlockhash: z.string().min(32).max(64),
    lockLastValidBlockHeight: z.number().int().positive(),
  }).strict(),
]);

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
    .neq("status", "completed");
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
  if (launch.metadataUri !== row.metadata_uri) {
    throw new OnChainVerificationError("Creation metadata does not match recovery state", 422);
  }
  return launch;
}

async function markCreateFinalized(row: IntentRow): Promise<IntentRow> {
  await verifyIntentLaunch(row);
  const { data, error } = await getServerClient()
    .from("launch_intents")
    .update({ status: "create_finalized", updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "create_submitted")
    .select("*")
    .maybeSingle<IntentRow>();
  if (error || !data) throw new Error("Failed to reconcile launch recovery state");
  return data;
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
    if (row.status !== "prepared" && row.status !== "create_submitted") {
      return apiError("Creation checkpoint is out of order", 409);
    }
    if (row.create_tx && row.create_tx !== body.createTxSignature) {
      return apiError("Creation signature cannot be replaced", 409);
    }
    const { error: updateError } = await getServerClient()
      .from("launch_intents")
      .update({
        create_tx: body.createTxSignature,
        create_blockhash: body.createBlockhash,
        create_last_valid_block_height: body.createLastValidBlockHeight,
        status: "create_submitted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return updateError ? apiError("Failed to save creation checkpoint", 503) : apiResponse({ success: true });
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
  const { error: updateError } = await getServerClient()
    .from("launch_intents")
    .update({
      lock_tx: body.lockTxSignature,
      lock_metadata_id: body.lockMetadataId,
      lock_amount: body.lockAmount,
      unlock_timestamp: body.unlockTimestamp,
      lock_blockhash: body.lockBlockhash,
      lock_last_valid_block_height: body.lockLastValidBlockHeight,
      status: "lock_submitted",
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  return updateError ? apiError("Failed to save lock checkpoint", 503) : apiResponse({ success: true });
}
