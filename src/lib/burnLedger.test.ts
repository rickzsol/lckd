import assert from "node:assert/strict";
import test from "node:test";
import { calculateBurnTotals, parseBurnEvents, type BurnEventRow } from "./burnLedger";

const row = (overrides: Partial<BurnEventRow>): BurnEventRow => ({
  kind: "burn",
  signature: "finalized-signature",
  sol_amount: null,
  lckd_amount: null,
  executed_at: "2026-07-18T12:00:00.000Z",
  ...overrides,
});

test("counts one combined launch event as both a buyback and burn", () => {
  const events = parseBurnEvents([
    row({ sol_amount: "0.1", lckd_amount: "125000.5" }),
  ]);

  assert.deepEqual(calculateBurnTotals(events), {
    solSpent: 0.1,
    lckdBought: 125000.5,
    lckdBurned: 125000.5,
  });
});

test("keeps legacy split buyback and burn rows compatible", () => {
  const events = parseBurnEvents([
    row({
      kind: "buyback",
      signature: "legacy-buyback",
      sol_amount: 0.2,
      lckd_amount: 200000,
    }),
    row({ signature: "legacy-burn", lckd_amount: 200000 }),
  ]);

  assert.deepEqual(calculateBurnTotals(events), {
    solSpent: 0.2,
    lckdBought: 200000,
    lckdBurned: 200000,
  });
});

test("derives buyback totals from populated amounts for burn rows", () => {
  const events = parseBurnEvents([
    row({ sol_amount: 0.1, lckd_amount: 90000 }),
    row({ lckd_amount: 10000 }),
  ]);

  assert.deepEqual(calculateBurnTotals(events), {
    solSpent: 0.1,
    lckdBought: 90000,
    lckdBurned: 100000,
  });
});

test("ignores unknown kinds and rejects malformed or non-positive amounts", () => {
  const events = parseBurnEvents([
    row({ kind: "queued", sol_amount: 0.1, lckd_amount: 100 }),
    row({ sol_amount: "0.1 SOL", lckd_amount: -100 }),
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].solAmount, null);
  assert.equal(events[0].lckdAmount, null);
  assert.deepEqual(calculateBurnTotals(events), {
    solSpent: 0,
    lckdBought: 0,
    lckdBurned: 0,
  });
});
