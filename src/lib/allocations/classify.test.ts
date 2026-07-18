import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyEnhancedTransaction,
  type MintTrackingContext,
} from "./classify";

const MINT = "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_MINT = "MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const TREASURY = "WalletTreasury111111111111111111111111111111";
const MARKETING = "WalletMarketing11111111111111111111111111111";
const OUTSIDER = "WalletOutsider111111111111111111111111111111";

const CONTEXT: MintTrackingContext = {
  tokenId: "token-1",
  mint: MINT,
  wallets: new Set([TREASURY, MARKETING]),
};

interface FixtureChange {
  owner: string;
  amount: string;
  mint?: string;
}

function enhancedTx(
  changes: FixtureChange[],
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    signature: "5".repeat(64),
    slot: 433_600_000,
    timestamp: 1_784_600_000,
    type: "TRANSFER",
    source: "SYSTEM_PROGRAM",
    accountData: changes.map((change) => ({
      account: `${change.owner}-ata`,
      tokenBalanceChanges: [
        {
          mint: change.mint ?? MINT,
          userAccount: change.owner,
          tokenAccount: `${change.owner}-ata`,
          rawTokenAmount: { decimals: 6, tokenAmount: change.amount },
        },
      ],
    })),
    ...overrides,
  };
}

test("outflow to an external wallet classifies as distributed", () => {
  const movements = classifyEnhancedTransaction(
    enhancedTx([
      { owner: TREASURY, amount: "-1000000000000" },
      { owner: OUTSIDER, amount: "1000000000000" },
    ]),
    [CONTEXT],
  );
  assert.equal(movements.length, 1);
  assert.deepEqual(
    {
      direction: movements[0].direction,
      amount: movements[0].amount,
      classification: movements[0].classification,
      counterparty: movements[0].counterpartyWallet,
    },
    {
      direction: "out",
      amount: "1000000000000",
      classification: "distributed",
      counterparty: OUTSIDER,
    },
  );
});

test("swap type and dex sources classify outflows as sold", () => {
  for (const overrides of [{ type: "SWAP" }, { source: "RAYDIUM" }, { source: "PUMP_AMM" }]) {
    const movements = classifyEnhancedTransaction(
      enhancedTx(
        [
          { owner: MARKETING, amount: "-500" },
          { owner: OUTSIDER, amount: "500" },
        ],
        overrides,
      ),
      [CONTEXT],
    );
    assert.equal(movements[0].classification, "sold");
  }
});

test("moves between two tracked wallets classify as internal on both sides", () => {
  const movements = classifyEnhancedTransaction(
    enhancedTx([
      { owner: TREASURY, amount: "-42" },
      { owner: MARKETING, amount: "42" },
    ]),
    [CONTEXT],
  );
  assert.equal(movements.length, 2);
  assert.ok(movements.every((movement) => movement.classification === "internal"));
});

test("burn type classifies as burned even without a counterparty", () => {
  const movements = classifyEnhancedTransaction(
    enhancedTx([{ owner: TREASURY, amount: "-99" }], { type: "BURN" }),
    [CONTEXT],
  );
  assert.equal(movements[0].classification, "burned");
  assert.equal(movements[0].counterpartyWallet, null);
});

test("inflow from outside classifies as received", () => {
  const movements = classifyEnhancedTransaction(
    enhancedTx([
      { owner: OUTSIDER, amount: "-7" },
      { owner: MARKETING, amount: "7" },
    ]),
    [CONTEXT],
  );
  assert.deepEqual(
    { direction: movements[0].direction, classification: movements[0].classification },
    { direction: "in", classification: "received" },
  );
});

test("outflow with no counterparty and no burn marker stays unknown", () => {
  const movements = classifyEnhancedTransaction(
    enhancedTx([{ owner: TREASURY, amount: "-1" }]),
    [CONTEXT],
  );
  assert.equal(movements[0].classification, "unknown");
});

test("other mints, untracked wallets, and zero deltas are ignored", () => {
  const movements = classifyEnhancedTransaction(
    enhancedTx([
      { owner: TREASURY, amount: "-5", mint: OTHER_MINT },
      { owner: OUTSIDER, amount: "-3" },
      { owner: MARKETING, amount: "0" },
    ]),
    [CONTEXT],
  );
  assert.equal(movements.length, 0);
});

test("amounts beyond float precision survive as exact raw strings", () => {
  const hugeAmount = "999999999999999999";
  const movements = classifyEnhancedTransaction(
    enhancedTx([
      { owner: TREASURY, amount: `-${hugeAmount}` },
      { owner: OUTSIDER, amount: hugeAmount },
    ]),
    [CONTEXT],
  );
  assert.equal(movements[0].amount, hugeAmount);
});

test("split token accounts for one owner net into a single movement", () => {
  const transaction = {
    signature: "6".repeat(64),
    timestamp: 1_784_600_000,
    type: "TRANSFER",
    accountData: [
      {
        tokenBalanceChanges: [
          {
            mint: MINT,
            userAccount: TREASURY,
            rawTokenAmount: { decimals: 6, tokenAmount: "-300" },
          },
          {
            mint: MINT,
            userAccount: TREASURY,
            rawTokenAmount: { decimals: 6, tokenAmount: "100" },
          },
        ],
      },
      {
        tokenBalanceChanges: [
          {
            mint: MINT,
            userAccount: OUTSIDER,
            rawTokenAmount: { decimals: 6, tokenAmount: "200" },
          },
        ],
      },
    ],
  };
  const movements = classifyEnhancedTransaction(transaction, [CONTEXT]);
  assert.equal(movements.length, 1);
  assert.deepEqual(
    { direction: movements[0].direction, amount: movements[0].amount },
    { direction: "out", amount: "200" },
  );
});

test("transactions without a signature yield nothing", () => {
  const transaction = enhancedTx([{ owner: TREASURY, amount: "-1" }]);
  Reflect.deleteProperty(transaction as object, "signature");
  assert.deepEqual(classifyEnhancedTransaction(transaction, [CONTEXT]), []);
});
