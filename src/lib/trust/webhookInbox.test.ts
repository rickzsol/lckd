import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertInboxEvents, normalizeHeliusBatch, type NormalizedEvent } from "./webhookInbox";

const KEY = "So11111111111111111111111111111111111111112";
const KEY2 = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

test("normalizeHeliusBatch skips entries without a signature and counts them rejected", () => {
  const { events, rejected } = normalizeHeliusBatch([
    { signature: "sig-a", type: "TRANSFER", accountKeys: [KEY] },
    { type: "TRANSFER", accountKeys: [KEY] },
    null,
    "not-an-object",
    { signature: "", type: "TRANSFER", accountKeys: [KEY] },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].signature, "sig-a");
  assert.equal(rejected, 4);
});

test("entries with no usable account keys are rejected, not persisted", () => {
  const { events, rejected } = normalizeHeliusBatch([
    { signature: "sig-a", type: "TRANSFER" },
    { signature: "sig-b", type: "TRANSFER", accountKeys: ["not-base58!"] },
  ]);
  assert.equal(events.length, 0);
  assert.equal(rejected, 2);
});

test("dedup identity is (signature, type), not batch position", () => {
  // Same signature+type at different positions is one subevent; the identity
  // must not embed the index, so a reordered retry maps to the same key.
  const a = normalizeHeliusBatch([
    { signature: "sig-a", type: "TRANSFER", accountKeys: [KEY] },
    { signature: "sig-b", type: "TRANSFER", accountKeys: [KEY] },
  ]);
  const reordered = normalizeHeliusBatch([
    { signature: "sig-b", type: "TRANSFER", accountKeys: [KEY] },
    { signature: "sig-a", type: "TRANSFER", accountKeys: [KEY] },
  ]);
  const keyOf = (e: NormalizedEvent) => `${e.provider}|${e.signature}|${e.event_type}`;
  assert.deepEqual(new Set(a.events.map(keyOf)), new Set(reordered.events.map(keyOf)));
  // No event carries a positional field.
  assert.equal("event_index" in a.events[0], false);
});

test("an in-batch duplicate of the same subevent is collapsed", () => {
  const { events } = normalizeHeliusBatch([
    { signature: "sig-a", type: "TRANSFER", accountKeys: [KEY] },
    { signature: "sig-a", type: "TRANSFER", accountKeys: [KEY2] },
  ]);
  assert.equal(events.length, 1);
});

test("normalizeHeliusBatch defaults missing type and slot", () => {
  const { events } = normalizeHeliusBatch([{ signature: "sig-a", accountKeys: [KEY] }]);
  assert.equal(events[0].event_type, "UNKNOWN");
  assert.equal(events[0].slot, null);
  assert.equal(events[0].provider, "helius");
});

test("identical batches produce stable dedup keys and payload hashes", () => {
  const raw = [{ signature: "sig-a", type: "TRANSFER", slot: 10, accountKeys: [KEY] }];
  const first = normalizeHeliusBatch(raw);
  const second = normalizeHeliusBatch(raw.map((entry) => ({ ...entry })));
  assert.deepEqual(
    first.events.map((e) => e.payload_hash),
    second.events.map((e) => e.payload_hash),
  );
});

test("insertInboxEvents forwards the stable onConflict target and returns the count", async () => {
  const calls: { table?: string; options?: unknown } = {};
  const supabase = {
    from(table: string) {
      calls.table = table;
      return {
        upsert(_rows: unknown, options: unknown) {
          calls.options = options;
          return {
            select() {
              return Promise.resolve({ data: [{ id: "a" }, { id: "b" }], error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  const { events } = normalizeHeliusBatch([
    { signature: "sig-a", type: "TRANSFER", accountKeys: [KEY] },
    { signature: "sig-b", type: "TRANSFER", accountKeys: [KEY] },
  ]);
  const count = await insertInboxEvents(supabase, events);

  assert.equal(count, 2);
  assert.equal(calls.table, "webhook_inbox");
  assert.deepEqual(calls.options, {
    onConflict: "provider,signature,event_type",
    ignoreDuplicates: true,
  });
});

test("insertInboxEvents returns 0 for an empty batch without touching supabase", async () => {
  let called = false;
  const supabase = {
    from() {
      called = true;
      throw new Error("should not be called");
    },
  } as unknown as SupabaseClient;

  const count = await insertInboxEvents(supabase, []);
  assert.equal(count, 0);
  assert.equal(called, false);
});

test("insertInboxEvents throws when the upsert reports an error", async () => {
  const supabase = {
    from() {
      return {
        upsert() {
          return {
            select() {
              return Promise.resolve({ data: null, error: { message: "boom" } });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  const { events } = normalizeHeliusBatch([{ signature: "sig-a", type: "TRANSFER", accountKeys: [KEY] }]);
  await assert.rejects(() => insertInboxEvents(supabase, events), /boom/);
});
