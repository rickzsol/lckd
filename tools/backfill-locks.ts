/**
 * Staged backfill of the `locks` table from existing verified lock receipts.
 *
 * Runs OUTSIDE the schema migration (per plan 2.4 / round-2 delta 10): the
 * denominator columns (total_supply_raw, decimals, lock_bps) land nullable in
 * `20260718000000_trust_locks.sql`, this script fills them from finalized RPC,
 * and only then does a follow-up migration enforce NOT NULL. Never enforce
 * NOT NULL before a verified backfill.
 *
 * Correctness properties (findings 9 & 10):
 *  - Keyset pagination over tokens.id: every verified token is reachable across
 *    runs, not just the first `--limit` rows.
 *  - On conflict it UPDATES nullable denominator fields (and status), so a rerun
 *    fills rows whose denominator was missing on a previous pass instead of
 *    ignoring them.
 *  - Raw amounts (deposited, withdrawn, total_supply) are written as decimal
 *    STRINGS; the u64/u128 supply is never narrowed through Number().
 *  - Status is DERIVED from finalized on-chain state (locked / unlock_eligible /
 *    withdrawn / anomalous), not hardcoded to "locked".
 *  - Missing provenance (no stream metadata id, or no creation signature/slot)
 *    is rejected for that row rather than substituted with placeholders like
 *    creation_slot 0.
 *  - Public availability is gated: locks_public returns nothing until this script
 *    records trust_kv.backfill_complete = 'true', which it only does when a full
 *    pass leaves ZERO canonical locks with a null denominator. So `lock: null`
 *    is never exposed to the public between migration and a verified backfill.
 *
 * This is a TOOL, not a route. Run manually with tsx once production Supabase is
 * restored.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... HELIUS_RPC_URL=... \
 *        npx tsx tools/backfill-locks.ts [--dry-run] [--page-size N]
 *
 * BLOCKER NOTE: production Supabase is offline in this environment, so this
 * script is written against the same client/RPC types the app uses and is not
 * executed here. The follow-up NOT NULL migration is stubbed at the bottom.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createClient } from "@supabase/supabase-js";
import { ICluster, PROGRAM_ID, SolanaStreamClient, StreamType } from "@streamflow/stream";
import type BN from "bn.js";

interface CliArgs {
  dryRun: boolean;
  pageSize: number;
}

function parseArgs(argv: string[]): CliArgs {
  const flag = argv.indexOf("--page-size");
  const pageSize = flag >= 0 ? Number.parseInt(argv[flag + 1] ?? "", 10) : 200;
  return {
    dryRun: argv.includes("--dry-run"),
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 1_000) : 200,
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

/** Reads the on-chain owner of an account at finalized commitment. Returns null
 * for an absent account (never treated as evidence). Used to assert the stream
 * account is genuinely owned by the pinned Streamflow program (finding 3). */
async function readAccountOwner(
  connection: Connection,
  address: string,
): Promise<string | null> {
  const info = await connection.getAccountInfo(new PublicKey(address), "finalized");
  return info === null ? null : info.owner.toBase58();
}

/** Full-cliff acceptance mirroring the SDK's isCliffCloseToDepositedAmount:
 * cliffAmount within [depositedAmount - 1, depositedAmount] (finding 3-new). */
export function isFullCliffAmount(cliffAmount: BN, depositedAmount: BN): boolean {
  if (cliffAmount.gt(depositedAmount)) return false;
  return cliffAmount.gte(depositedAmount.subn(1));
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

/** lock_bps = deposited * 10000 / totalSupply, computed with BigInt only. */
function computeLockBps(deposited: bigint, totalSupplyRaw: bigint): number | null {
  if (totalSupplyRaw <= BigInt(0)) return null;
  const bps = (deposited * BigInt(10_000)) / totalSupplyRaw;
  const value = Number(bps);
  return Number.isFinite(value) && value >= 0 && value <= 10_000 ? value : null;
}

/** Derives lock status from finalized amounts + cliff, mirroring the runtime
 * derivation: pre-cliff movement is anomalous, full/closed withdrawal is
 * withdrawn, partial or time-eligible is unlock_eligible, else locked. */
export function deriveBackfillStatus(
  deposited: bigint,
  withdrawn: bigint,
  closed: boolean,
  cliffRawSeconds: number,
  nowSeconds: number,
): "locked" | "unlock_eligible" | "withdrawn" | "anomalous" {
  if (withdrawn > deposited) return "anomalous";
  const beforeCliff = nowSeconds < cliffRawSeconds;
  if (beforeCliff && (withdrawn > BigInt(0) || closed)) return "anomalous";
  if (closed || (deposited > BigInt(0) && withdrawn >= deposited)) return "withdrawn";
  if (withdrawn > BigInt(0)) return "unlock_eligible";
  return nowSeconds >= cliffRawSeconds ? "unlock_eligible" : "locked";
}

interface VerifiedTokenRow {
  id: string;
  mint_address: string;
  creator_wallet: string;
  lock_tx: string | null;
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

  let inserted = 0;
  let skipped = 0;
  let denominatorMissing = 0;
  let afterId: string | null = null;

  // Keyset pagination over id ascending: every verified token is reachable.
  for (;;) {
    let query = supabase
      .from("tokens")
      .select("id, mint_address, creator_wallet, lock_tx, lock_amount, lock_verified_at, lock_unlock_at")
      .not("launch_verified_at", "is", null)
      .not("lock_verified_at", "is", null)
      .order("id", { ascending: true })
      .limit(args.pageSize);
    if (afterId) query = query.gt("id", afterId);

    const { data, error } = await query;
    if (error) throw new Error(`token read failed: ${error.message}`);
    const tokens = (data ?? []) as VerifiedTokenRow[];
    if (tokens.length === 0) break;
    afterId = tokens[tokens.length - 1].id;

    for (const token of tokens) {
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

        // Reject missing provenance rather than substituting placeholders. The
        // creation signature/slot must come from the launch intent or lock_tx;
        // there is no valid "slot 0" fallback (finding 10).
        const creationSignature = launchIntent?.creation_signature ?? token.lock_tx ?? null;
        const creationSlot = launchIntent?.creation_slot ?? null;
        if (!creationSignature || creationSlot === null) {
          console.warn(
            `[backfill] missing provenance (sig/slot) for token ${token.id}, skipping`,
          );
          skipped += 1;
          continue;
        }

        // Read the ACTUAL account owner from finalized state and require it to be
        // the pinned Streamflow program (finding 3). getOne would decode bytes even
        // under an impostor program; the on-chain owner is the ground truth.
        const ownerProgram = await readAccountOwner(connection, streamId);
        if (ownerProgram === null) {
          console.warn(`[backfill] stream ${streamId} account absent for ${token.id}, skipping`);
          skipped += 1;
          continue;
        }
        if (ownerProgram !== streamProgram) {
          console.warn(
            `[backfill] stream ${streamId} owner ${ownerProgram} != pinned ${streamProgram} for ${token.id}, skipping`,
          );
          skipped += 1;
          continue;
        }

        const stream = await streamClient.getOne({ id: streamId });
        if (stream.type !== StreamType.Lock) {
          console.warn(`[backfill] stream ${streamId} is not a lock, skipping ${token.id}`);
          skipped += 1;
          continue;
        }
        // Prove the stream actually locks THIS token's mint before crediting it
        // (finding 3): a stream that locks a different mint is not evidence for
        // this token. cliffAmount must release the full deposit (cliff lock), and
        // the deposit must match the recorded lock_amount.
        if (stream.mint !== token.mint_address) {
          console.warn(`[backfill] stream ${streamId} mint mismatch for ${token.id}, skipping`);
          skipped += 1;
          continue;
        }
        // SDK full-cliff acceptance: cliffAmount within [deposited - 1, deposited].
        // buildLockParams emits a one-unit residual tail, so strict equality wrongly
        // rejects valid locks (finding 3-new).
        if (!isFullCliffAmount(stream.cliffAmount, stream.depositedAmount)) {
          console.warn(`[backfill] stream ${streamId} is not a full-cliff lock, skipping ${token.id}`);
          skipped += 1;
          continue;
        }
        if (stream.depositedAmount.toString() !== token.lock_amount) {
          console.warn(
            `[backfill] stream ${streamId} deposit ${stream.depositedAmount.toString()} != recorded ` +
              `lock_amount ${token.lock_amount} for ${token.id}, skipping`,
          );
          skipped += 1;
          continue;
        }
        // Compare recipient + escrow against the stored provenance rather than
        // silently trusting the decoded stream (finding 3). When the launch intent
        // recorded them, the decoded stream must match; a mismatch means this is not
        // the lock we recorded and must not be credited to this token.
        if (launchIntent?.recipient && stream.recipient !== launchIntent.recipient) {
          console.warn(
            `[backfill] stream ${streamId} recipient ${stream.recipient} != recorded ` +
              `${launchIntent.recipient} for ${token.id}, skipping`,
          );
          skipped += 1;
          continue;
        }
        if (launchIntent?.escrow_ata && stream.escrowTokens !== launchIntent.escrow_ata) {
          console.warn(
            `[backfill] stream ${streamId} escrow ${stream.escrowTokens} != recorded ` +
              `${launchIntent.escrow_ata} for ${token.id}, skipping`,
          );
          skipped += 1;
          continue;
        }
        const deposited = BigInt(stream.depositedAmount.toString());
        const withdrawn = BigInt(stream.withdrawnAmount.toString());
        const cliffRaw = stream.cliff;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const status = deriveBackfillStatus(
          deposited,
          withdrawn,
          stream.closed === true,
          cliffRaw,
          nowSeconds,
        );

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
          // Raw amounts as decimal strings; never Number(u64).
          deposited_amount: deposited.toString(),
          cliff_ts: new Date(cliffRaw * 1000).toISOString(),
          cliff_ts_raw: cliffRaw,
          withdrawn_amount: withdrawn.toString(),
          total_supply_raw: totalSupplyRaw !== null ? totalSupplyRaw.toString() : null,
          decimals,
          lock_bps: lockBps,
          status,
          canonical: true,
          creation_signature: creationSignature,
          creation_slot: creationSlot,
        };

        if (args.dryRun) {
          console.log(`[backfill] would upsert lock for ${token.mint_address}`, {
            status,
            lockBps,
            hasDenominator: totalSupplyRaw !== null,
          });
          continue;
        }

        // Update-on-conflict: a rerun fills a previously-null denominator and
        // refreshes the derived status instead of ignoring the existing row.
        const { error: insertError } = await supabase
          .from("locks")
          .upsert(row, { onConflict: "cluster,stream_program,stream_id", ignoreDuplicates: false });
        if (insertError) throw new Error(insertError.message);
        inserted += 1;
      } catch (rowError) {
        skipped += 1;
        console.error(`[backfill] failed for token ${token.id}:`, rowError);
      }
    }

    if (tokens.length < args.pageSize) break;
  }

  // Gate public availability on a verified complete pass. It is NOT enough that
  // existing canonical locks have no null denominator: a token that was skipped
  // (no stream metadata, missing provenance, mint/owner mismatch) has NO lock row
  // at all, and counting only present rows would flip complete=true while eligible
  // tokens are still unrepresented. Compare EXPECTED eligible tokens against DONE
  // verified canonical locks and require full coverage (finding 10).
  let backfillComplete = false;
  let expected = 0;
  let done = 0;
  if (!args.dryRun) {
    const { count: expectedCount, error: expectedError } = await supabase
      .from("tokens")
      .select("id", { count: "exact", head: true })
      .not("launch_verified_at", "is", null)
      .not("lock_verified_at", "is", null);
    if (expectedError) throw new Error(`expected-count check failed: ${expectedError.message}`);

    const { count: doneCount, error: doneError } = await supabase
      .from("locks")
      .select("id", { count: "exact", head: true })
      .eq("canonical", true)
      .not("total_supply_raw", "is", null)
      .not("decimals", "is", null)
      .not("lock_bps", "is", null);
    if (doneError) throw new Error(`done-count check failed: ${doneError.message}`);

    expected = expectedCount ?? 0;
    done = doneCount ?? 0;
    backfillComplete = isBackfillComplete(expected, done);
    const { error: kvError } = await supabase
      .from("trust_kv")
      .upsert(
        { key: "backfill_complete", value: backfillComplete ? "true" : "false", updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    if (kvError) throw new Error(`backfill_complete update failed: ${kvError.message}`);
  }

  console.log(
    `[backfill] done. inserted=${inserted} skipped=${skipped} ` +
      `denominatorMissing=${denominatorMissing} expected=${expected} done=${done} ` +
      `backfillComplete=${backfillComplete} dryRun=${args.dryRun}`,
  );
  if (!backfillComplete && !args.dryRun && expected > done) {
    console.log(
      `[backfill] ${expected - done} eligible token(s) still lack a verified canonical lock. ` +
        "Re-run once RPC is stable; locks_public stays gated (empty) until every eligible " +
        "token has a verified lock and backfill_complete flips to true.",
    );
  }
}

/**
 * Backfill is complete only when every eligible token is represented by a fully
 * verified canonical lock: done must equal expected (finding 10). With no eligible
 * tokens (expected 0) there is nothing to withhold, so it is trivially complete.
 * done exceeding expected (stale extra rows) is not treated as complete; it means
 * the counts are inconsistent and a human should look before exposing data.
 */
export function isBackfillComplete(expected: number, done: number): boolean {
  if (expected === 0) return true;
  return done === expected;
}

const entry = process.argv[1] ?? "";
if (entry.includes("backfill-locks") && !entry.includes(".test")) {
  main().catch((error) => {
    console.error("[backfill] fatal:", error);
    process.exit(1);
  });
}

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
