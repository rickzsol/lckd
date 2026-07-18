import "server-only";

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { getServerClient } from "@/lib/supabase";
import { getReadConnection } from "./balances";
import { insertMovements } from "./ingest";
import { movementFromParsedTransaction, type BackfillContext } from "./backfillParse";

// Walks a drifted wallet's recent ATA history over plain RPC and repairs
// the transfer ledger. Bounded per run; the next reconciliation pass
// confirms whether the drift closed. Atomic launch mints are legacy SPL,
// so the default ATA derivation is correct for every tracked launch.

const SIGNATURE_FETCH_LIMIT = 25;

export async function backfillWalletHistory(context: BackfillContext): Promise<number> {
  const connection = getReadConnection();
  const ata = getAssociatedTokenAddressSync(
    new PublicKey(context.mint),
    new PublicKey(context.wallet),
    true,
  );

  const signatureInfos = await connection.getSignaturesForAddress(
    ata,
    { limit: SIGNATURE_FETCH_LIMIT },
    "confirmed",
  );
  const signatures = signatureInfos
    .filter((info) => !info.err)
    .map((info) => info.signature);
  if (signatures.length === 0) return 0;

  const { data: existing, error } = await getServerClient()
    .from("allocation_transfers")
    .select("signature")
    .eq("wallet_address", context.wallet)
    .in("signature", signatures);
  if (error) throw new Error(`Backfill dedup query failed: ${error.message}`);

  const known = new Set((existing ?? []).map((row) => row.signature));
  const missing = signatures.filter((signature) => !known.has(signature));
  if (missing.length === 0) return 0;

  const transactions = await connection.getParsedTransactions(missing, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  const movements = [];
  for (let index = 0; index < transactions.length; index++) {
    const movement = movementFromParsedTransaction(
      transactions[index],
      missing[index],
      context,
    );
    if (movement) movements.push(movement);
  }
  return insertMovements(movements, "backfill");
}
