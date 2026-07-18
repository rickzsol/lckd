import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  movementFromParsedTransaction,
  type BackfillContext,
} from "./backfillParse";

const MINT = Keypair.generate().publicKey.toBase58();
const WALLET = Keypair.generate().publicKey.toBase58();
const TRACKED = Keypair.generate().publicKey.toBase58();
const OUTSIDER = Keypair.generate().publicKey.toBase58();
const SIGNATURE = "8".repeat(64);

const [OFF_CURVE] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault")],
  SystemProgram.programId,
);

const CONTEXT: BackfillContext = {
  tokenId: "token-1",
  mint: MINT,
  wallet: WALLET,
  trackedWallets: new Set([WALLET, TRACKED]),
};

interface Balance {
  owner: string;
  amount: string;
}

function parsedTx(
  pre: Balance[],
  post: Balance[],
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    blockTime: 1_784_600_000,
    slot: 433_700_000,
    meta: {
      err: null,
      preTokenBalances: pre.map((balance, accountIndex) => ({
        accountIndex,
        mint: MINT,
        owner: balance.owner,
        uiTokenAmount: { amount: balance.amount },
      })),
      postTokenBalances: post.map((balance, accountIndex) => ({
        accountIndex,
        mint: MINT,
        owner: balance.owner,
        uiTokenAmount: { amount: balance.amount },
      })),
      innerInstructions: [],
    },
    transaction: { message: { instructions: [] } },
    ...overrides,
  };
}

test("wallet to wallet outflow classifies as distributed", () => {
  const movement = movementFromParsedTransaction(
    parsedTx(
      [{ owner: WALLET, amount: "1000" }, { owner: OUTSIDER, amount: "0" }],
      [{ owner: WALLET, amount: "400" }, { owner: OUTSIDER, amount: "600" }],
    ),
    SIGNATURE,
    CONTEXT,
  );
  assert.deepEqual(
    {
      direction: movement?.direction,
      amount: movement?.amount,
      classification: movement?.classification,
      recordedSource: movement?.source,
    },
    { direction: "out", amount: "600", classification: "distributed", recordedSource: null },
  );
});

test("moves to another tracked wallet classify as internal", () => {
  const movement = movementFromParsedTransaction(
    parsedTx(
      [{ owner: WALLET, amount: "50" }, { owner: TRACKED, amount: "0" }],
      [{ owner: WALLET, amount: "0" }, { owner: TRACKED, amount: "50" }],
    ),
    SIGNATURE,
    CONTEXT,
  );
  assert.equal(movement?.classification, "internal");
});

test("program-owned counterparties stay unknown instead of guessing sold", () => {
  const movement = movementFromParsedTransaction(
    parsedTx(
      [{ owner: WALLET, amount: "100" }, { owner: OFF_CURVE.toBase58(), amount: "0" }],
      [{ owner: WALLET, amount: "0" }, { owner: OFF_CURVE.toBase58(), amount: "100" }],
    ),
    SIGNATURE,
    CONTEXT,
  );
  assert.equal(movement?.classification, "unknown");
});

test("burn instructions classify outflows as burned", () => {
  const movement = movementFromParsedTransaction(
    parsedTx(
      [{ owner: WALLET, amount: "10" }],
      [{ owner: WALLET, amount: "0" }],
      {
        transaction: {
          message: {
            instructions: [
              { parsed: { type: "burn", info: { mint: MINT } } },
            ],
          },
        },
      },
    ),
    SIGNATURE,
    CONTEXT,
  );
  assert.equal(movement?.classification, "burned");
});

test("inflows from plain wallets classify as received", () => {
  const movement = movementFromParsedTransaction(
    parsedTx(
      [{ owner: OUTSIDER, amount: "80" }, { owner: WALLET, amount: "0" }],
      [{ owner: OUTSIDER, amount: "0" }, { owner: WALLET, amount: "80" }],
    ),
    SIGNATURE,
    CONTEXT,
  );
  assert.deepEqual(
    { direction: movement?.direction, classification: movement?.classification },
    { direction: "in", classification: "received" },
  );
});

test("failed transactions and untouched wallets yield nothing", () => {
  assert.equal(
    movementFromParsedTransaction(
      parsedTx(
        [{ owner: WALLET, amount: "10" }],
        [{ owner: WALLET, amount: "0" }],
        { meta: { err: { InstructionError: [0, "Custom"] }, preTokenBalances: [], postTokenBalances: [] } },
      ),
      SIGNATURE,
      CONTEXT,
    ),
    null,
  );
  assert.equal(
    movementFromParsedTransaction(
      parsedTx(
        [{ owner: OUTSIDER, amount: "5" }],
        [{ owner: OUTSIDER, amount: "5" }],
      ),
      SIGNATURE,
      CONTEXT,
    ),
    null,
  );
  assert.equal(movementFromParsedTransaction(null, SIGNATURE, CONTEXT), null);
});
