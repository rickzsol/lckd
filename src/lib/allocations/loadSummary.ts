import "server-only";

import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";
import { buildAllocationSummary, type AllocationSummary } from "./summary";

// Shared read path for the public allocation summary, used by both the
// GET API route and the token page server component. Anon client only;
// everything returned here is publicly readable.

const TRANSFER_FETCH_LIMIT = 5_000;
const SNAPSHOT_FETCH_LIMIT = 500;

export interface AllocationPageData {
  summary: AllocationSummary;
  creatorWallet: string;
  lockedAmountRaw: string | null;
}

export async function loadAllocationData(
  mintAddress: string,
): Promise<AllocationPageData | null> {
  if (!hasSupabaseConfig()) return null;

  const supabase = getSupabase();
  const { data: token, error: tokenError } = await supabase
    .from("tokens")
    .select("id, creator_wallet, lock_amount")
    .eq("mint_address", mintAddress)
    .not("launch_verified_at", "is", null)
    .not("lock_verified_at", "is", null)
    .maybeSingle();
  if (tokenError) throw new Error(`Token lookup failed: ${tokenError.message}`);
  if (!token) return null;

  const [buckets, wallets, transfers, snapshots] = await Promise.all([
    supabase
      .from("allocation_buckets")
      .select("*")
      .eq("token_id", token.id)
      .order("declared_at", { ascending: true }),
    supabase
      .from("allocation_wallets")
      .select("*")
      .eq("token_id", token.id),
    supabase
      .from("allocation_transfers")
      .select("*")
      .eq("token_id", token.id)
      .order("block_time", { ascending: false })
      .limit(TRANSFER_FETCH_LIMIT),
    supabase
      .from("allocation_snapshots")
      .select("*")
      .eq("token_id", token.id)
      .order("captured_at", { ascending: false })
      .limit(SNAPSHOT_FETCH_LIMIT),
  ]);
  const failed = [buckets, wallets, transfers, snapshots].find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);

  return {
    summary: buildAllocationSummary(
      buckets.data ?? [],
      wallets.data ?? [],
      transfers.data ?? [],
      snapshots.data ?? [],
    ),
    creatorWallet: token.creator_wallet,
    lockedAmountRaw: /^\d+$/.test(token.lock_amount ?? "") ? token.lock_amount : null,
  };
}
