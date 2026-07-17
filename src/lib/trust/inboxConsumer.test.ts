import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { backoffSeconds, markProcessed, recordFailure, shouldDeadLetter } from "./inboxConsumer";

test("backoff doubles from 30s per attempt", () => {
  assert.equal(backoffSeconds(1), 30);
  assert.equal(backoffSeconds(2), 60);
  assert.equal(backoffSeconds(3), 120);
  assert.equal(backoffSeconds(4), 240);
});

test("backoff clamps a zero or negative attempt count to the base", () => {
  assert.equal(backoffSeconds(0), 30);
  assert.equal(backoffSeconds(-5), 30);
});

test("backoff is capped at one hour", () => {
  assert.equal(backoffSeconds(20), 3_600);
  assert.equal(backoffSeconds(1_000), 3_600);
});

test("shouldDeadLetter triggers at or above five attempts", () => {
  assert.equal(shouldDeadLetter(4), false);
  assert.equal(shouldDeadLetter(5), true);
  assert.equal(shouldDeadLetter(6), true);
});

// --- lease fencing (finding 8) ---------------------------------------------

function rpcStub(rows: number, capture: { fn?: string; args?: unknown }) {
  return {
    rpc(fn: string, args: unknown) {
      capture.fn = fn;
      capture.args = args;
      return Promise.resolve({ data: rows, error: null });
    },
  } as unknown as SupabaseClient;
}

test("markProcessed calls the fenced RPC with the lease id and reports success", async () => {
  const capture: { fn?: string; args?: unknown } = {};
  const applied = await markProcessed(rpcStub(1, capture), "row-1", "lease-1", "2026-07-17T00:00:00.000Z");
  assert.equal(applied, true);
  assert.equal(capture.fn, "complete_inbox_row");
  assert.deepEqual(capture.args, {
    p_id: "row-1",
    p_lease_id: "lease-1",
    p_processed_at: "2026-07-17T00:00:00.000Z",
  });
});

test("markProcessed reports failure when no row matched the lease (0 updated)", async () => {
  const applied = await markProcessed(rpcStub(0, {}), "row-1", "stale-lease", "2026-07-17T00:00:00.000Z");
  assert.equal(applied, false);
});

test("recordFailure schedules a retry with the lease and backoff before the budget is spent", async () => {
  const capture: { fn?: string; args?: unknown } = {};
  const now = 1_000_000;
  await recordFailure(rpcStub(1, capture), "row-1", "lease-1", 2, now);
  assert.equal(capture.fn, "fail_inbox_row");
  const args = capture.args as { p_dead_letter: boolean; p_next_retry_at: string; p_lease_id: string };
  assert.equal(args.p_lease_id, "lease-1");
  assert.equal(args.p_dead_letter, false);
  assert.equal(args.p_next_retry_at, new Date(now + backoffSeconds(2) * 1_000).toISOString());
});

test("recordFailure dead-letters once the attempt budget is exhausted", async () => {
  const capture: { fn?: string; args?: unknown } = {};
  await recordFailure(rpcStub(1, capture), "row-1", "lease-1", 5, 1_000_000);
  const args = capture.args as { p_dead_letter: boolean; p_next_retry_at: string | null };
  assert.equal(args.p_dead_letter, true);
  assert.equal(args.p_next_retry_at, null);
});
