import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import {
  validateDeclaration,
  MAX_TOTAL_SUPPLY_RAW,
  type DeclaredBucketInput,
  type DeclarationContext,
} from "./declarationValidation";

const mintAddress = Keypair.generate().publicKey.toBase58();
const creatorWallet = Keypair.generate().publicKey.toBase58();
const escrowAddress = Keypair.generate().publicKey.toBase58();
const treasuryWallet = Keypair.generate().publicKey.toBase58();
const marketingWallet = Keypair.generate().publicKey.toBase58();
const trackedWallet = Keypair.generate().publicKey.toBase58();

function context(overrides: Partial<DeclarationContext> = {}): DeclarationContext {
  return {
    mintAddress,
    creatorWallet,
    escrowAddress,
    existingActiveWallets: new Set([trackedWallet]),
    ...overrides,
  };
}

function bucket(overrides: Partial<DeclaredBucketInput> = {}): DeclaredBucketInput {
  return {
    category: "treasury",
    label: "treasury",
    declaredAmount: "100000000000000",
    wallets: [treasuryWallet],
    ...overrides,
  };
}

test("accepts a well formed declaration", () => {
  assert.equal(
    validateDeclaration(
      [
        bucket(),
        bucket({ category: "marketing", label: "marketing", wallets: [marketingWallet] }),
      ],
      context(),
    ),
    null,
  );
});

test("rejects empty and oversized bucket lists", () => {
  assert.ok(validateDeclaration([], context()));
  assert.ok(validateDeclaration(Array.from({ length: 7 }, () => bucket()), context()));
});

test("rejects malformed and zero amounts", () => {
  assert.ok(validateDeclaration([bucket({ declaredAmount: "12.5" })], context()));
  assert.ok(validateDeclaration([bucket({ declaredAmount: "-5" })], context()));
  assert.ok(validateDeclaration([bucket({ declaredAmount: "0" })], context()));
});

test("rejects totals above the fixed pump.fun supply", () => {
  assert.ok(
    validateDeclaration(
      [bucket({ declaredAmount: (MAX_TOTAL_SUPPLY_RAW + BigInt(1)).toString() })],
      context(),
    ),
  );
  assert.equal(
    validateDeclaration(
      [bucket({ declaredAmount: MAX_TOTAL_SUPPLY_RAW.toString() })],
      context(),
    ),
    null,
  );
});

test("rejects invalid, mint, and escrow wallet addresses", () => {
  assert.ok(validateDeclaration([bucket({ wallets: ["not-a-wallet"] })], context()));
  assert.ok(validateDeclaration([bucket({ wallets: [mintAddress] })], context()));
  assert.ok(validateDeclaration([bucket({ wallets: [escrowAddress] })], context()));
});

test("escrow check is skipped when no escrow is known", () => {
  assert.equal(
    validateDeclaration(
      [bucket({ wallets: [escrowAddress] })],
      context({ escrowAddress: null }),
    ),
    null,
  );
});

test("rejects wallet reuse inside the payload and against tracked wallets", () => {
  assert.ok(
    validateDeclaration(
      [
        bucket(),
        bucket({ category: "marketing", label: "marketing", wallets: [treasuryWallet] }),
      ],
      context(),
    ),
  );
  assert.ok(validateDeclaration([bucket({ wallets: [trackedWallet] })], context()));
});

test("rejects label and wallet count violations", () => {
  assert.ok(validateDeclaration([bucket({ label: "  " })], context()));
  assert.ok(validateDeclaration([bucket({ label: "x".repeat(41) })], context()));
  assert.ok(validateDeclaration([bucket({ wallets: [] })], context()));
  assert.ok(
    validateDeclaration(
      [bucket({ wallets: Array.from({ length: 6 }, () => Keypair.generate().publicKey.toBase58()) })],
      context(),
    ),
  );
});
