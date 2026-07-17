import assert from "node:assert/strict";
import test from "node:test";
import type { Connection } from "@solana/web3.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TrustTier } from "@/types/index";
import { reconcileLock } from "./reconcileLock";
import type { DecodedStream, StreamReadResult } from "./lockVerification";
import type { LockRow } from "@/types/trust";

const CLIFF = "2026-01-01T00:00:00.000Z";
const CLIFF_RAW = String(Math.floor(new Date(CLIFF).getTime() / 1000));
const AFTER = new Date(CLIFF).getTime() + 1_000;
const BEFORE = new Date(CLIFF).getTime() - 1_000;

const PROGRAM = "Str11111111111111111111111111111111111111";
const MINT = "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const RECIPIENT = "RcptBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const ESCROW = "EscrCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

function lockRow(overrides: Partial<LockRow> = {}): LockRow {
  return {
    id: "lock-1",
    token_id: "tok-1",
    mint: MINT,
    stream_program: PROGRAM,
    stream_id: "StreamMeta1111111111111111111111111111111111",
    deposited_amount: "100",
    withdrawn_amount: "0",
    total_supply_raw: "1000",
    decimals: 6,
    lock_bps: 1000,
    cliff_ts: CLIFF,
    status: "locked",
    canonical: true,
    last_verified_at: null,
    recipient: RECIPIENT,
    cluster: "mainnet",
    escrow_ata: ESCROW,
    cliff_ts_raw: CLIFF_RAW,
    creation_signature: "sig",
    creation_slot: "10",
    last_verified_signature: null,
    last_verified_slot: null,
    created_at: CLIFF,
    ...overrides,
  };
}

function decoded(overrides: Partial<DecodedStream> = {}): DecodedStream {
  return {
    streamProgram: PROGRAM,
    mint: MINT,
    sender: RECIPIENT,
    recipient: RECIPIENT,
    escrowTokens: ESCROW,
    depositedAmount: BigInt(100),
    withdrawnAmount: BigInt(0),
    cliff: Number(CLIFF_RAW),
    cliffAmount: BigInt(100),
    start: Number(CLIFF_RAW),
    end: Number(CLIFF_RAW) + 1,
    period: 1,
    amountPerPeriod: BigInt(1),
    isLock: true,
    closed: false,
    ...overrides,
  };
}

interface Captured {
  rpc?: { fn: string; args: Record<string, unknown> };
  tokenSelect: string[];
}

/** Minimal supabase mock: tokens.select().eq().maybeSingle() returns a canned
 * token; rpc() captures the commit_lock_reconciliation payload. */
function supabaseMock(token: { trust_tier: TrustTier; github_tier: TrustTier | null }): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = { tokenSelect: [] };
  const client = {
    from() {
      return {
        select(cols: string) {
          captured.tokenSelect.push(cols);
          return {
            eq() {
              return {
                maybeSingle() {
                  return Promise.resolve({ data: token, error: null });
                },
              };
            },
          };
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      captured.rpc = { fn, args };
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return { client, captured };
}

const conn = {} as Connection;
const reader = (result: StreamReadResult) => () => Promise.resolve(result);

test("a matching, still-locked stream keeps the github tier and commits atomically", async () => {
  const { client, captured } = supabaseMock({ trust_tier: TrustTier.BUILDER, github_tier: TrustTier.BUILDER });
  const outcome = await reconcileLock(
    client,
    conn,
    lockRow(),
    BEFORE,
    "vsig",
    "42",
    reader({ kind: "ok", stream: decoded() }),
  );
  assert.equal(captured.rpc?.fn, "commit_lock_reconciliation");
  assert.equal(captured.rpc?.args.p_status, "locked");
  assert.equal(captured.rpc?.args.p_trust_tier, TrustTier.BUILDER);
  assert.equal(outcome.tierChanged, false);
});

test("github_tier is the independent evidence, not the already-floored trust_tier", async () => {
  // trust_tier was floored to LOCKED by a previous expiry; github_tier still
  // holds BUILDER. A now-valid lock must restore BUILDER from github_tier.
  const { client, captured } = supabaseMock({ trust_tier: TrustTier.LOCKED, github_tier: TrustTier.BUILDER });
  const outcome = await reconcileLock(
    client,
    conn,
    lockRow({ status: "locked" }),
    BEFORE,
    null,
    null,
    reader({ kind: "ok", stream: decoded() }),
  );
  assert.equal(captured.rpc?.args.p_trust_tier, TrustTier.BUILDER);
  assert.equal(outcome.tierChanged, true);
  // Selected github_tier explicitly.
  assert.ok(captured.tokenSelect.some((c) => c.includes("github_tier")));
});

test("a mismatched stream is committed anomalous and floors the tier", async () => {
  const { client, captured } = supabaseMock({ trust_tier: TrustTier.SHIPPED, github_tier: TrustTier.SHIPPED });
  await reconcileLock(
    client,
    conn,
    lockRow(),
    AFTER,
    null,
    null,
    reader({ kind: "ok", stream: decoded({ mint: "WrongMint1111111111111111111111111111111111" }) }),
  );
  assert.equal(captured.rpc?.args.p_status, "anomalous");
  assert.equal(captured.rpc?.args.p_trust_tier, TrustTier.LOCKED);
});

test("an rpc read failure aborts without any commit (finding 2)", async () => {
  const { client, captured } = supabaseMock({ trust_tier: TrustTier.BUILDER, github_tier: TrustTier.BUILDER });
  await assert.rejects(
    () =>
      reconcileLock(
        client,
        conn,
        lockRow(),
        AFTER,
        null,
        null,
        reader({ kind: "rpc_error", message: "timeout" }),
      ),
    /timeout|unavailable/i,
  );
  assert.equal(captured.rpc, undefined); // never committed.
});

test("a decoded fully-withdrawn stream after the cliff commits withdrawn and floors the tier", async () => {
  const { client, captured } = supabaseMock({ trust_tier: TrustTier.BUILDER, github_tier: TrustTier.BUILDER });
  await reconcileLock(
    client,
    conn,
    lockRow(),
    AFTER,
    null,
    null,
    reader({ kind: "ok", stream: decoded({ withdrawnAmount: BigInt(100), closed: true }) }),
  );
  assert.equal(captured.rpc?.args.p_status, "withdrawn");
  assert.equal(captured.rpc?.args.p_trust_tier, TrustTier.LOCKED);
});

test("an absent account never commits withdrawn: it aborts (finding 2)", async () => {
  const { client, captured } = supabaseMock({ trust_tier: TrustTier.BUILDER, github_tier: TrustTier.BUILDER });
  await assert.rejects(
    () => reconcileLock(client, conn, lockRow(), AFTER, null, null, reader({ kind: "not_found" })),
    /absent|unavailable/i,
  );
  assert.equal(captured.rpc, undefined); // never committed a withdrawal.
});
