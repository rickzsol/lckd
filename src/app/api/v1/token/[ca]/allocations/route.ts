import { type NextRequest } from "next/server";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { requireLinkedWallet } from "@/lib/api/auth";
import { requireSameOrigin } from "@/lib/api/origin";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { getServerClient, getSupabase } from "@/lib/supabase";
import { isValidSolanaAddress } from "@/lib/api/validation";
import { ALLOCATION_CATEGORIES } from "@/types";
import {
  validateDeclaration,
  MAX_BUCKETS_PER_DECLARATION,
  MAX_WALLETS_PER_BUCKET,
} from "@/lib/allocations/declarationValidation";
import { getOwnerMintBalance, BalanceReadError } from "@/lib/allocations/balances";
import { loadAllocationData } from "@/lib/allocations/loadSummary";
import { syncTrackedWallets } from "@/lib/helius/webhookAdmin";

export { OPTIONS };

const STREAMFLOW_PROGRAM_ID = "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m";

const declareSchema = z.object({
  buckets: z.array(
    z.object({
      category: z.enum(ALLOCATION_CATEGORIES),
      label: z.string().trim().min(1).max(40),
      declaredAmount: z.string().regex(/^\d{1,20}$/),
      wallets: z.array(z.string().min(32).max(44)).min(1).max(MAX_WALLETS_PER_BUCKET),
    }).strict(),
  ).min(1).max(MAX_BUCKETS_PER_DECLARATION),
}).strict();

interface TokenRow {
  id: string;
  mint_address: string;
  creator_wallet: string;
}

async function loadVerifiedToken(ca: string): Promise<TokenRow | null> {
  const { data, error } = await getSupabase()
    .from("tokens")
    .select("id, mint_address, creator_wallet")
    .eq("mint_address", ca)
    .not("launch_verified_at", "is", null)
    .not("lock_verified_at", "is", null)
    .maybeSingle();
  if (error) throw new Error(`Token lookup failed: ${error.message}`);
  return (data as TokenRow | null) ?? null;
}

async function deriveEscrowAddress(mintAddress: string): Promise<string | null> {
  const { data, error } = await getServerClient()
    .from("launch_intents")
    .select("lock_metadata_id")
    .eq("mint_address", mintAddress)
    .maybeSingle();
  if (error || !data?.lock_metadata_id) return null;
  try {
    const [escrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("strm"), new PublicKey(data.lock_metadata_id).toBuffer()],
      new PublicKey(STREAMFLOW_PROGRAM_ID),
    );
    return escrow.toBase58();
  } catch {
    return null;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ca: string }> },
) {
  const { ca } = await params;
  if (!isValidSolanaAddress(ca)) return apiError("Invalid token address", 400);

  try {
    const data = await loadAllocationData(ca);
    if (!data) return apiError("Token not found", 404);
    return apiResponse(data.summary);
  } catch (error) {
    console.error("[allocations] Read failed:", error instanceof Error ? error.message : error);
    return apiError("Allocation data is unavailable", 503);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ca: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const limited = await checkRateLimit(request, "record");
  if (limited) return limited;

  const { session, error: authError } = await requireLinkedWallet();
  if (authError) return authError;

  const { ca } = await params;
  if (!isValidSolanaAddress(ca)) return apiError("Invalid token address", 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError("Invalid JSON", 400);
  }
  const parsed = declareSchema.safeParse(raw);
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);

  let token: TokenRow | null;
  try {
    token = await loadVerifiedToken(ca);
  } catch (error) {
    console.error("[allocations] Token lookup failed:", error);
    return apiError("Allocation declaration is unavailable", 503);
  }
  if (!token) return apiError("Token not found", 404);
  if (token.creator_wallet !== session.wallet_address) {
    return apiError("Only the creator can declare allocations", 403);
  }

  const serverClient = getServerClient();
  const { data: existingWallets, error: existingError } = await serverClient
    .from("allocation_wallets")
    .select("wallet_address")
    .eq("token_id", token.id)
    .eq("status", "active");
  if (existingError) {
    console.error("[allocations] Wallet lookup failed:", existingError.message);
    return apiError("Allocation declaration is unavailable", 503);
  }

  const context = {
    mintAddress: token.mint_address,
    creatorWallet: token.creator_wallet,
    escrowAddress: await deriveEscrowAddress(token.mint_address),
    existingActiveWallets: new Set(
      (existingWallets ?? []).map((row) => row.wallet_address),
    ),
  };
  const validationError = validateDeclaration(parsed.data.buckets, context);
  if (validationError) return apiError(validationError, 422);

  const balances = new Map<string, string>();
  try {
    for (const bucket of parsed.data.buckets) {
      for (const wallet of bucket.wallets) {
        balances.set(
          wallet,
          (await getOwnerMintBalance(wallet, token.mint_address)).toString(),
        );
      }
    }
  } catch (error) {
    if (error instanceof BalanceReadError) return apiError(error.message, error.status);
    console.error("[allocations] Balance read failed:", error);
    return apiError("Wallet balance verification is unavailable", 503);
  }

  let bucketCount = 0;
  let walletCount = 0;
  for (const bucket of parsed.data.buckets) {
    const { data: bucketRow, error: bucketError } = await serverClient
      .from("allocation_buckets")
      .insert({
        token_id: token.id,
        category: bucket.category,
        label: bucket.label.trim(),
        declared_amount: bucket.declaredAmount,
      })
      .select("id")
      .single();
    if (bucketError || !bucketRow) {
      console.error("[allocations] Bucket insert failed:", bucketError?.message);
      return apiError("Failed to record the declaration", 503);
    }
    bucketCount += 1;

    const now = new Date().toISOString();
    const walletRows = bucket.wallets.map((wallet) => ({
      bucket_id: bucketRow.id,
      token_id: token.id,
      wallet_address: wallet,
      balance_at_declaration: balances.get(wallet) ?? "0",
      is_creator_wallet: wallet === token.creator_wallet,
    }));
    const { error: walletError } = await serverClient
      .from("allocation_wallets")
      .insert(walletRows);
    if (walletError) {
      console.error("[allocations] Wallet insert failed:", walletError.message);
      const isConflict = walletError.code === "23505";
      return apiError(
        isConflict ? "A wallet is already tracked for this token" : "Failed to record the declaration",
        isConflict ? 409 : 503,
      );
    }
    walletCount += walletRows.length;

    const { error: snapshotError } = await serverClient
      .from("allocation_snapshots")
      .insert(walletRows.map((row) => ({
        token_id: token.id,
        wallet_address: row.wallet_address,
        balance: row.balance_at_declaration,
        captured_at: now,
      })));
    if (snapshotError) {
      console.error("[allocations] Snapshot insert failed:", snapshotError.message);
    }
  }

  let webhookSync: "synced" | "deferred" = "synced";
  try {
    await syncTrackedWallets();
  } catch (error) {
    // The declaration is durable; the reconciliation cron re-syncs the
    // webhook address set, so a Helius outage must not fail the request.
    console.error("[allocations] Webhook sync deferred:", error);
    webhookSync = "deferred";
  }

  return apiResponse(
    { success: true, buckets: bucketCount, wallets: walletCount, webhookSync },
    201,
  );
}
