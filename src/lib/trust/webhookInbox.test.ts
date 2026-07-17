import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertInboxEvents, normalizeHeliusBatch, type NormalizedEvent } from "./webhookInbox";

test("normalizeHeliusBatch skips entries without a signature", () => {
  const events = normalizeHeliusBatch([
    { signature: "sig-a", type: "TRANSFER" },
    { type: "TRANSFER" },
    null,
    "not-an-object",
    { signature: "", type: "TRANSFER" },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].signature, "sig-a");
});

test("event_index is the positional index in the batch", () => {
  const events = normalizeHeliusBatch([
    { signature: "sig-a", type: "TRANSFER" },
    { type: "TRANSFER" },
    { signature: "sig-c", type: "UNKNOWN" },
  ]);
  assert.equal(events[0].event_index, 0);
  assert.equal(events[1].event_index, 2);
});

test("normalizeHeliusBatch defaults missing type and slot", () => {
  const [event] = normalizeHeliusBatch([{ signature: "sig-a" }]);
  assert.equal(event.event_type, "UNKNOWN");
  assert.equal(event.slot, null);
  assert.equal(event.provider, "helius");
});

test("identical batches produce stable dedup keys and payload hashes", () => {
  const raw = [
    { signature: "sig-a", type: "TRANSFER", slot: 10, accountKeys: ["acc-1"] },
    { signature: "sig-a", type: "TRANSFER", slot: 10, accountKeys: ["acc-1"] },
  ];
  const first = normalizeHeliusBatch(raw);
  const second = normalizeHeliusBatch(raw.map((entry) => ({ ...entry })));

  const key = (event: NormalizedEvent) =>
    `${event.provider}|${event.signature}|${event.event_index}|${event.event_type}`;
  assert.deepEqual(first.map(key), second.map(key));
  assert.deepEqual(
    first.map((event) => event.payload_hash),
    second.map((event) => event.payload_hash),
  );
});

test("insertInboxEvents forwards onConflict and ignoreDuplicates and returns the inserted count", async () => {
  const calls: { table?: string; rows?: unknown; options?: unknown } = {};
  const supabase = {
    from(table: string) {
      calls.table = table;
      return {
        upsert(rows: unknown, options: unknown) {
          calls.rows = rows;
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

  const events = normalizeHeliusBatch([
    { signature: "sig-a", type: "TRANSFER" },
    { signature: "sig-b", type: "TRANSFER" },
  ]);
  const count = await insertInboxEvents(supabase, events);

  assert.equal(count, 2);
  assert.equal(calls.table, "webhook_inbox");
  assert.deepEqual(calls.options, {
    onConflict: "provider,signature,event_index,event_type",
    ignoreDuplicates: true,
  });
  assert.equal(calls.rows, events);
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

  const events = normalizeHeliusBatch([{ signature: "sig-a", type: "TRANSFER" }]);
  await assert.rejects(() => insertInboxEvents(supabase, events), /boom/);
});
