import assert from "node:assert/strict";
import test from "node:test";
import { buildAllocationSummary } from "./summary";
import type {
  AllocationBucket,
  AllocationSnapshot,
  AllocationTransfer,
  AllocationWallet,
} from "@/types";

const TREASURY = "WalletTreasury111111111111111111111111111111";
const MARKETING = "WalletMarketing11111111111111111111111111111";

const buckets: AllocationBucket[] = [
  {
    id: "bucket-1",
    token_id: "token-1",
    category: "treasury",
    label: "treasury",
    declared_amount: "1000",
    status: "active",
    superseded_by: null,
    declared_at: "2026-07-01T00:00:00Z",
    retired_at: null,
  },
  {
    id: "bucket-2",
    token_id: "token-1",
    category: "marketing",
    label: "marketing",
    declared_amount: "500",
    status: "active",
    superseded_by: null,
    declared_at: "2026-07-01T00:00:00Z",
    retired_at: null,
  },
];

const wallets: AllocationWallet[] = [
  {
    id: "wallet-1",
    bucket_id: "bucket-1",
    token_id: "token-1",
    wallet_address: TREASURY,
    balance_at_declaration: "1000",
    is_creator_wallet: false,
    status: "active",
    created_at: "2026-07-01T00:00:00Z",
  },
  {
    id: "wallet-2",
    bucket_id: "bucket-2",
    token_id: "token-1",
    wallet_address: MARKETING,
    balance_at_declaration: "500",
    is_creator_wallet: false,
    status: "active",
    created_at: "2026-07-01T00:00:00Z",
  },
];

function transfer(overrides: Partial<AllocationTransfer>): AllocationTransfer {
  return {
    id: "transfer-x",
    token_id: "token-1",
    wallet_address: TREASURY,
    direction: "out",
    amount: "0",
    counterparty_wallet: null,
    classification: "distributed",
    source: null,
    signature: "7".repeat(64),
    slot: null,
    block_time: "2026-07-10T00:00:00Z",
    recorded_via: "webhook",
    created_at: "2026-07-10T00:00:01Z",
    ...overrides,
  };
}

function snapshot(overrides: Partial<AllocationSnapshot>): AllocationSnapshot {
  return {
    id: "snapshot-x",
    token_id: "token-1",
    wallet_address: TREASURY,
    balance: "0",
    drift: null,
    captured_at: "2026-07-15T00:00:00Z",
    ...overrides,
  };
}

test("aggregates per bucket distributed, sold, and current balance", () => {
  const summary = buildAllocationSummary(
    buckets,
    wallets,
    [
      transfer({ amount: "200", classification: "distributed" }),
      transfer({ amount: "100", classification: "sold" }),
      transfer({
        amount: "50",
        wallet_address: MARKETING,
        classification: "distributed",
      }),
      transfer({ amount: "25", direction: "in", classification: "received" }),
    ],
    [
      snapshot({ balance: "700" }),
      snapshot({ balance: "450", wallet_address: MARKETING }),
    ],
  );

  const treasury = summary.buckets.find((bucket) => bucket.id === "bucket-1");
  assert.deepEqual(
    {
      distributed: treasury?.distributed,
      sold: treasury?.sold,
      currentBalance: treasury?.currentBalance,
    },
    { distributed: "200", sold: "100", currentBalance: "700" },
  );

  const marketing = summary.buckets.find((bucket) => bucket.id === "bucket-2");
  assert.equal(marketing?.distributed, "50");
  assert.deepEqual(
    { distributed: summary.totals.distributed, sold: summary.totals.sold },
    { distributed: "250", sold: "100" },
  );
});

test("inflows never count toward outflow totals", () => {
  const summary = buildAllocationSummary(
    buckets,
    wallets,
    [transfer({ amount: "999", direction: "in", classification: "received" })],
    [],
  );
  assert.equal(summary.totals.distributed, "0");
  assert.equal(summary.buckets[0]?.distributed, "0");
});

test("falls back to declaration balance when no snapshot exists", () => {
  const summary = buildAllocationSummary(buckets, wallets, [], []);
  assert.equal(summary.buckets[0]?.currentBalance, "1000");
});

test("uses only the latest snapshot per wallet and surfaces drift", () => {
  const summary = buildAllocationSummary(
    buckets,
    wallets,
    [],
    [
      snapshot({ balance: "900", captured_at: "2026-07-10T00:00:00Z" }),
      snapshot({ balance: "800", drift: "-100", captured_at: "2026-07-16T00:00:00Z" }),
    ],
  );
  assert.equal(summary.buckets[0]?.currentBalance, "800");
  assert.equal(summary.hasUnreconciledDrift, true);
});

test("recent transfers are capped and mapped to the public shape", () => {
  const many = Array.from({ length: 30 }, (_, index) =>
    transfer({ id: `transfer-${index}`, amount: `${index + 1}` }),
  );
  const summary = buildAllocationSummary(buckets, wallets, many, []);
  assert.equal(summary.recentTransfers.length, 25);
  assert.deepEqual(Object.keys(summary.recentTransfers[0]).sort(), [
    "amount",
    "blockTime",
    "classification",
    "counterpartyTracked",
    "counterpartyWallet",
    "direction",
    "isFinal",
    "signature",
    "walletAddress",
  ]);
  assert.equal(summary.recentTransfers[0].isFinal, false);
});
