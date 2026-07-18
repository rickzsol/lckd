import "server-only";

import { getServerClient } from "@/lib/supabase";
import {
  classifyEnhancedTransaction,
  type ClassifiedMovement,
  type MintTrackingContext,
} from "./classify";

// Turns an enhanced Helius webhook payload into allocation_transfers rows.
// Inserts are idempotent on (signature, wallet, direction, amount) so
// Helius retries and reconciliation backfills never double-count.

const MAX_PAYLOAD_TRANSACTIONS = 100;

export interface IngestResult {
  processed: number;
  inserted: number;
}

export class IngestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function collectInvolvedOwners(transactions: unknown[]): Set<string> {
  const owners = new Set<string>();
  for (const transaction of transactions) {
    if (!transaction || typeof transaction !== "object") continue;
    const accountData = Reflect.get(transaction, "accountData");
    if (!Array.isArray(accountData)) continue;
    for (const account of accountData) {
      const changes = account && typeof account === "object"
        ? Reflect.get(account, "tokenBalanceChanges")
        : null;
      if (!Array.isArray(changes)) continue;
      for (const change of changes) {
        const owner = change && typeof change === "object"
          ? Reflect.get(change, "userAccount")
          : null;
        if (typeof owner === "string" && owner.length > 0) owners.add(owner);
      }
    }
  }
  return owners;
}

async function loadTrackingContexts(
  owners: ReadonlySet<string>,
): Promise<MintTrackingContext[]> {
  if (owners.size === 0) return [];
  const { data, error } = await getServerClient()
    .from("allocation_wallets")
    .select("wallet_address, token_id, tokens!inner(mint_address)")
    .eq("status", "active")
    .in("wallet_address", [...owners]);
  if (error) {
    throw new IngestError(`Tracked wallet lookup failed: ${error.message}`, 503);
  }

  const byToken = new Map<string, MintTrackingContext>();
  for (const row of data ?? []) {
    const tokens = row.tokens as unknown;
    const mint = tokens && typeof tokens === "object"
      ? Reflect.get(tokens, "mint_address")
      : null;
    if (typeof mint !== "string") continue;
    const existing = byToken.get(row.token_id);
    if (existing) {
      (existing.wallets as Set<string>).add(row.wallet_address);
    } else {
      byToken.set(row.token_id, {
        tokenId: row.token_id,
        mint,
        wallets: new Set([row.wallet_address]),
      });
    }
  }

  if (byToken.size === 0) return [];

  // A payload wallet only proves membership; the full active wallet set per
  // token is needed so internal moves between two bucket wallets classify
  // correctly even when only one side appears in this payload.
  const { data: allWallets, error: allError } = await getServerClient()
    .from("allocation_wallets")
    .select("wallet_address, token_id")
    .eq("status", "active")
    .in("token_id", [...byToken.keys()]);
  if (allError) {
    throw new IngestError(`Token wallet lookup failed: ${allError.message}`, 503);
  }
  for (const row of allWallets ?? []) {
    const context = byToken.get(row.token_id);
    if (context) (context.wallets as Set<string>).add(row.wallet_address);
  }

  return [...byToken.values()];
}

export async function insertMovements(
  movements: readonly ClassifiedMovement[],
  recordedVia: "webhook" | "backfill",
): Promise<number> {
  if (movements.length === 0) return 0;
  const rows = movements.map((movement) => ({
    token_id: movement.tokenId,
    wallet_address: movement.walletAddress,
    direction: movement.direction,
    amount: movement.amount,
    counterparty_wallet: movement.counterpartyWallet,
    classification: movement.classification,
    source: movement.source,
    signature: movement.signature,
    slot: movement.slot,
    block_time: movement.blockTime,
    recorded_via: recordedVia,
  }));
  const { data, error } = await getServerClient()
    .from("allocation_transfers")
    .upsert(rows, {
      onConflict: "signature,wallet_address,direction,amount",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) {
    throw new IngestError(`Transfer insert failed: ${error.message}`, 503);
  }
  return data?.length ?? 0;
}

export async function ingestEnhancedPayload(payload: unknown): Promise<IngestResult> {
  if (!Array.isArray(payload)) {
    throw new IngestError("Webhook payload must be an array", 400);
  }
  if (payload.length > MAX_PAYLOAD_TRANSACTIONS) {
    throw new IngestError("Webhook payload exceeds the transaction limit", 413);
  }

  const contexts = await loadTrackingContexts(collectInvolvedOwners(payload));
  if (contexts.length === 0) return { processed: payload.length, inserted: 0 };

  const movements = payload.flatMap((transaction) =>
    classifyEnhancedTransaction(transaction, contexts),
  );
  const inserted = await insertMovements(movements, "webhook");
  return { processed: payload.length, inserted };
}
