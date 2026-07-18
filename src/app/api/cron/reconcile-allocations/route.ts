import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getServerClient } from "@/lib/supabase";
import { getOwnerMintBalance } from "@/lib/allocations/balances";
import { backfillWalletHistory } from "@/lib/allocations/backfill";
import { syncTrackedWallets } from "@/lib/helius/webhookAdmin";

// Daily reconciliation: webhooks are the fast path, this cron is the
// truth. It snapshots real chain balances for every tracked wallet,
// records drift against the transfer ledger instead of hiding it, and
// re-asserts the Helius webhook address set.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_CONCURRENCY = 5;

interface TrackedWallet {
  tokenId: string;
  mint: string;
  walletAddress: string;
  balanceAtDeclaration: string;
}

function isValidSecret(received: string | null | undefined): boolean {
  const expected = process.env.CRON_SECRET;
  if (!received || !expected) return false;
  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(received);
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

async function loadTrackedWallets(
  supabase: ReturnType<typeof getServerClient>,
): Promise<TrackedWallet[]> {
  const { data, error } = await supabase
    .from("allocation_wallets")
    .select("wallet_address, token_id, balance_at_declaration, tokens!inner(mint_address)")
    .eq("status", "active");
  if (error) throw new Error(`Tracked wallet query failed: ${error.message}`);

  const wallets: TrackedWallet[] = [];
  for (const row of data ?? []) {
    const tokens = row.tokens as unknown;
    const mint = tokens && typeof tokens === "object"
      ? Reflect.get(tokens, "mint_address")
      : null;
    if (typeof mint !== "string") continue;
    wallets.push({
      tokenId: row.token_id,
      mint,
      walletAddress: row.wallet_address,
      balanceAtDeclaration: row.balance_at_declaration,
    });
  }
  return wallets;
}

async function ledgerNetFlow(
  supabase: ReturnType<typeof getServerClient>,
  tokenId: string,
  walletAddress: string,
): Promise<bigint> {
  const { data, error } = await supabase
    .from("allocation_transfers")
    .select("direction, amount")
    .eq("token_id", tokenId)
    .eq("wallet_address", walletAddress);
  if (error) throw new Error(`Ledger query failed: ${error.message}`);

  let net = BigInt(0);
  for (const row of data ?? []) {
    const amount = BigInt(row.amount);
    net += row.direction === "in" ? amount : -amount;
  }
  return net;
}

async function reconcileWallet(
  supabase: ReturnType<typeof getServerClient>,
  wallet: TrackedWallet,
  trackedWallets: ReadonlySet<string>,
): Promise<boolean> {
  const [chainBalance, netFlow] = await Promise.all([
    getOwnerMintBalance(wallet.walletAddress, wallet.mint),
    ledgerNetFlow(supabase, wallet.tokenId, wallet.walletAddress),
  ]);
  const expected = BigInt(wallet.balanceAtDeclaration) + netFlow;
  const drift = chainBalance - expected;

  const { error } = await supabase.from("allocation_snapshots").insert({
    token_id: wallet.tokenId,
    wallet_address: wallet.walletAddress,
    balance: chainBalance.toString(),
    drift: drift === BigInt(0) ? null : drift.toString(),
  });
  if (error) throw new Error(`Snapshot insert failed: ${error.message}`);

  if (drift !== BigInt(0)) {
    console.warn(
      `[cron/reconcile] Drift for ${wallet.walletAddress} on ${wallet.mint}: ${drift.toString()} (webhook gap; ledger is missing movements)`,
    );
    try {
      const repaired = await backfillWalletHistory({
        tokenId: wallet.tokenId,
        mint: wallet.mint,
        wallet: wallet.walletAddress,
        trackedWallets,
      });
      console.log(
        `[cron/reconcile] Backfilled ${repaired} movements for ${wallet.walletAddress}`,
      );
    } catch (backfillError) {
      // The snapshot already records the drift honestly; a failed repair
      // attempt must not fail reconciliation for the wallet.
      console.error("[cron/reconcile] Backfill failed:", backfillError);
    }
  }
  return drift !== BigInt(0);
}

export async function GET(req: Request) {
  const authorization = req.headers.get("authorization");
  const secret = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  if (!isValidSecret(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let supabase: ReturnType<typeof getServerClient>;
  try {
    supabase = getServerClient();
  } catch (error) {
    console.error("[cron/reconcile] Supabase configuration error:", error);
    return NextResponse.json({ error: "Cron service unavailable" }, { status: 503 });
  }

  let wallets: TrackedWallet[];
  try {
    wallets = await loadTrackedWallets(supabase);
  } catch (error) {
    console.error("[cron/reconcile] Wallet load failed:", error);
    return NextResponse.json({ error: "Failed to load tracked wallets" }, { status: 500 });
  }

  const walletsByToken = new Map<string, Set<string>>();
  for (const wallet of wallets) {
    const set = walletsByToken.get(wallet.tokenId) ?? new Set<string>();
    set.add(wallet.walletAddress);
    walletsByToken.set(wallet.tokenId, set);
  }

  let reconciled = 0;
  let drifted = 0;
  let failed = 0;
  for (let i = 0; i < wallets.length; i += BATCH_CONCURRENCY) {
    const batch = wallets.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((wallet) =>
        reconcileWallet(
          supabase,
          wallet,
          walletsByToken.get(wallet.tokenId) ?? new Set(),
        ),
      ),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        reconciled += 1;
        if (result.value) drifted += 1;
      } else {
        failed += 1;
        console.error("[cron/reconcile] Wallet reconcile failed:", result.reason);
      }
    }
  }

  let webhookAddresses = 0;
  let webhookHealthy = true;
  try {
    webhookAddresses = (await syncTrackedWallets()).addressCount;
  } catch (error) {
    webhookHealthy = false;
    console.error("[cron/reconcile] Webhook sync failed:", error);
  }

  const message = `Reconciled ${reconciled} wallets, ${drifted} drifted, ${failed} failed, webhook ${webhookHealthy ? "synced" : "unhealthy"} (${webhookAddresses} addresses)`;
  console.log(`[cron/reconcile] ${message}`);
  return NextResponse.json({ message, reconciled, drifted, failed, webhookHealthy });
}
