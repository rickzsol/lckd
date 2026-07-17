/**
 * Staged backfill of the `locks` table from existing verified lock receipts.
 *
 * Runs OUTSIDE the schema migration (per plan 2.4 / round-2 delta 10): the
 * denominator columns (total_supply_raw, decimals, lock_bps) land nullable in
 * `20260718000000_trust_locks.sql`, this script fills them from finalized RPC,
 * and only then does a follow-up migration enforce NOT NULL. Never enforce
 * NOT NULL before a verified backfill.
 *
 * Stages:
 *   1. Read verified tokens (launch_verified_at + lock_verified_at not null)
 *      joined to launch_intents for the stream metadata id / escrow / recipient.
 *   2. For each, read the finalized Streamflow stream + mint supply/decimals via
 *      RPC and compute lock_bps = deposited * 10000 / total_supply_raw.
 *   3. Insert a canonical lock row (nullable-first: denominator may be null if
 *      RPC verification fails, flagged for a later re-run).
 *
 * This is a TOOL, not a route. Run manually with tsx once production Supabase is
 * restored. It is idempotent via the locks_stream_unique constraint (upsert
 * ignore). It does NOT mutate tokens or tiers.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... HELIUS_RPC_URL=... \
 *        npx tsx tools/backfill-locks.ts [--dry-run] [--limit N]
 *
 * BLOCKER NOTE: production Supabase is offline in this environment, so this
 * script is written against the same client/RPC types the app uses and is not
 * executed here. The follow-up NOT NULL migration is stubbed at the bottom.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createClient } from "@supabase/supabase-js";
import { ICluster, PROGRAM_ID, SolanaStreamClient } from "@streamflow/stream";

interface CliArgs {
  dryRun: boolean;
  limit: number;
}

function parseArgs(argv: string[]): CliArgs {
  const limitFlag = argv.indexOf("--limit");
  const limit = limitFlag >= 0 ? Number.parseInt(argv[limitFlag + 1] ?? "", 10) : 500;
  return {
    dryRun: argv.includes("--dry-run"),
    limit: Number.isFinite(limit) && limit > 0 ? limit : 500,
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function inferCluster(rpcEndpoint: string): ICluster {
  const endpoint = rpcEndpoint.toLowerCase();
  if (endpoint.includes("devnet")) return ICluster.Devnet;
  if (endpoint.includes("testnet")) return ICluster.Testnet;
  if (endpoint.includes("localhost") || endpoint.includes("127.0.0.1")) return ICluster.Local;
  return ICluster.Mainnet;
}

interface FinalizedDenominator {
  totalSupplyRaw: bigint;
  decimals: number;
}

/** Reads finalized mint supply + decimals, carrying the owner program so
 * Token-2022 mints resolve (the create pipeline hard-codes legacy Token). */
async function readFinalizedSupply(
  connection: Connection,
  mint: string,
): Promise<FinalizedDenominator> {
  const mintPk = new PublicKey(mint);
  const accountInfo = await connection.getAccountInfo(mintPk, "finalized");
  if (!accountInfo) throw new Error(`Mint account not found: ${mint}`);
  const ownerProgram = accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
  const mintData = await getMint(connection, mintPk, "finalized", ownerProgram);
  return { totalSupplyRaw: mintData.supply, decimals: mintData.decimals };
}

function computeLockBps(deposited: bigint, totalSupplyRaw: bigint): number | null {
  if (totalSupplyRaw <= BigInt(0)) return null;
  const bps = (deposited * BigInt(10_000)) / totalSupplyRaw;
  const value = Number(bps);
  return Number.isFinite(value) && value >= 0 && value <= 10_000 ? value : null;
}

interface VerifiedTokenRow {
  id: string;
  mint_address: string;
  creator_wallet: string;
  lock_tx: string;
  lock_amount: string;
  lock_verified_at: string;
  lock_unlock_at: string;
}

interface LaunchIntentRow {
  token_id: string;
  stream_metadata_id: string | null;
  escrow_ata: string | null;
  recipient: string | null;
  creation_signature: string | null;
  creation_slot: number | null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const rpcUrl = requireEnv("HELIUS_RPC_URL");

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const connection = new Connection(rpcUrl, "finalized");
  const cluster = inferCluster(rpcUrl);
  const streamClient = new SolanaStreamClient({ clusterUrl: rpcUrl, cluster, commitment: "finalized" });
  const clusterName = cluster.toString();
  const streamProgram = PROGRAM_ID[cluster];

  const { data: tokens, error } = await supabase
    .from("tokens")
    .select("id, mint_address, creator_wallet, lock_tx, lock_amount, lock_verified_at, lock_unlock_at")
    .not("launch_verified_at", "is", null)
    .not("lock_verified_at", "is", null)
    .limit(args.limit);
  if (error) throw new Error(`token read failed: ${error.message}`);

  let inserted = 0;
  let skipped = 0;
  let denominatorMissing = 0;

  for (const token of (tokens ?? []) as VerifiedTokenRow[]) {
    try {
      const { data: intent } = await supabase
        .from("launch_intents")
        .select("token_id, stream_metadata_id, escrow_ata, recipient, creation_signature, creation_slot")
        .eq("token_id", token.id)
        .maybeSingle();
      const launchIntent = intent as LaunchIntentRow | null;

      const streamId = launchIntent?.stream_metadata_id;
      if (!streamId) {
        console.warn(`[backfill] no stream metadata for token ${token.id}, skipping`);
        skipped += 1;
        continue;
      }

      const stream = await streamClient.getOne({ id: streamId });
      const deposited = BigInt(stream.depositedAmount.toString());
      const withdrawn = BigInt(stream.withdrawnAmount.toString());
      const cliffRaw = stream.cliff;

      let totalSupplyRaw: bigint | null = null;
      let decimals: number | null = null;
      let lockBps: number | null = null;
      try {
        const denom = await readFinalizedSupply(connection, token.mint_address);
        totalSupplyRaw = denom.totalSupplyRaw;
        decimals = denom.decimals;
        lockBps = computeLockBps(deposited, denom.totalSupplyRaw);
      } catch (denomError) {
        denominatorMissing += 1;
        console.warn(`[backfill] denominator unresolved for ${token.mint_address}:`, denomError);
      }

      const row = {
        token_id: token.id,
        cluster: clusterName,
        mint: token.mint_address,
        stream_program: streamProgram,
        stream_id: streamId,
        escrow_ata: launchIntent?.escrow_ata ?? stream.escrowTokens ?? "",
        recipient: launchIntent?.recipient ?? stream.recipient,
        deposited_amount: deposited.toString(),
        cliff_ts: new Date(cliffRaw * 1000).toISOString(),
        cliff_ts_raw: cliffRaw,
        withdrawn_amount: withdrawn.toString(),
        total_supply_raw: totalSupplyRaw !== null ? Number(totalSupplyRaw) : null,
        decimals,
        lock_bps: lockBps,
        status: "locked" as const,
        canonical: true,
        creation_signature: launchIntent?.creation_signature ?? token.lock_tx,
        creation_slot: launchIntent?.creation_slot ?? 0,
      };

      if (args.dryRun) {
        console.log(`[backfill] would insert lock for ${token.mint_address}`, {
          lockBps,
          hasDenominator: totalSupplyRaw !== null,
        });
        continue;
      }

      const { error: insertError } = await supabase
        .from("locks")
        .upsert(row, { onConflict: "cluster,stream_program,stream_id", ignoreDuplicates: true });
      if (insertError) throw new Error(insertError.message);
      inserted += 1;
    } catch (rowError) {
      skipped += 1;
      console.error(`[backfill] failed for token ${token.id}:`, rowError);
    }
  }

  console.log(
    `[backfill] done. inserted=${inserted} skipped=${skipped} denominatorMissing=${denominatorMissing} dryRun=${args.dryRun}`,
  );
  if (denominatorMissing > 0) {
    console.log("[backfill] re-run once RPC is stable to fill missing denominators BEFORE enforcing NOT NULL.");
  }
}

main().catch((error) => {
  console.error("[backfill] fatal:", error);
  process.exit(1);
});

/*
 * FOLLOW-UP MIGRATION STUB (create as a separate timestamped file AFTER this
 * backfill has run cleanly and every canonical lock has a non-null denominator):
 *
 *   -- 2026XXXXXXXXXX_trust_locks_enforce_denominator.sql
 *   begin;
 *   -- Verify no nulls remain first:
 *   --   select count(*) from public.locks
 *   --   where total_supply_raw is null or decimals is null or lock_bps is null;
 *   alter table public.locks
 *     alter column total_supply_raw set not null,
 *     alter column decimals set not null,
 *     alter column lock_bps set not null;
 *   commit;
 *
 * Do NOT ship this stub as-is; it is intentionally inert here.
 */
