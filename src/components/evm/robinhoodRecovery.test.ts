import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hash, Hex } from "viem";
import {
  assertPreparedRecovery,
  assertSubmittedRecovery,
  canonicalizeRecoveryForm,
  isActiveRecovery,
  parseRobinhoodRecoveryIntent,
  type RobinhoodRecoveryIntent,
} from "./robinhoodRecovery";
import { loadLocalRecoveryMarker, saveLocalAmbiguousLaunch, saveLocalPendingLaunch } from "./recoveryLocal";
import type { RobinhoodLaunchFormData } from "./launchTypes";
import { validateRobinhoodLaunch } from "./launchValidation";
import { acquireSingleFlight, isUserRejectedWalletRequest } from "./ponsLaunchClient";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const SALT = `0x${"22".repeat(32)}` as Hex;
const HASH = `0x${"33".repeat(32)}` as Hash;

const FORM: RobinhoodLaunchFormData = {
  name: "Vault Token",
  symbol: "VLT",
  description: "Fixed supply launch",
  logo: "https://example.com/logo.png",
  twitter: "https://x.com/vault",
  telegram: "",
  website: "https://example.com",
  initialBuyEth: "0.005",
  feeWallet: WALLET,
  hasAcceptedPermanentLock: true,
};

function intent(overrides: Partial<RobinhoodRecoveryIntent> = {}): RobinhoodRecoveryIntent {
  return {
    id: "intent-1",
    status: "prepared",
    walletAddress: WALLET,
    salt: SALT,
    transactionHash: null,
    config: FORM,
    tokenAddress: null,
    poolAddress: null,
    positionId: null,
    error: null,
    ...overrides,
  };
}

test("canonicalizes the form before durable preparation", () => {
  const canonical = canonicalizeRecoveryForm({
    ...FORM,
    name: "  Vault Token  ",
    symbol: " vlt ",
    description: " Fixed supply launch ",
    initialBuyEth: " 0.005 ",
  });
  assert.deepEqual(canonical, FORM);
});

test("accepts only the exact prepared wallet, salt, and form", () => {
  assert.equal(assertPreparedRecovery(intent(), WALLET, SALT, FORM).id, "intent-1");
  assert.throws(
    () => assertPreparedRecovery(intent(), WALLET, SALT, { ...FORM, symbol: "OTHER" }),
    /does not match this exact launch intent/,
  );
});

test("rejects a submitted checkpoint with a different transaction hash", () => {
  const submitted = intent({ status: "submitted", transactionHash: HASH });
  assert.equal(assertSubmittedRecovery(submitted, submitted).transactionHash, HASH);
  assert.throws(
    () => assertSubmittedRecovery(submitted, { ...submitted, transactionHash: `0x${"44".repeat(32)}` as Hash }),
    /does not match the wallet transaction/,
  );
});

test("client validation matches durable amount and fee-wallet constraints", () => {
  assert.deepEqual(validateRobinhoodLaunch(FORM, true), {});
  assert.equal(
    validateRobinhoodLaunch({ ...FORM, initialBuyEth: "00.005" }, true).initialBuyEth,
    "Enter a valid ETH amount.",
  );
  assert.match(
    validateRobinhoodLaunch({ ...FORM, feeWallet: "0x0000000000000000000000000000000000000000" }, true).feeWallet ?? "",
    /nonzero/,
  );
});

test("parses ambiguous recovery as an active nonterminal intent", () => {
  const ambiguous = parseRobinhoodRecoveryIntent({
    ...intent(),
    status: "ambiguous",
  });
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(isActiveRecovery(ambiguous), true);
});

test("local ambiguous marker is replaced by a known transaction candidate", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  saveLocalAmbiguousLaunch(WALLET, SALT);
  assert.equal(loadLocalRecoveryMarker(WALLET)?.kind, "ambiguous");
  saveLocalPendingLaunch({ kind: "candidate", walletAddress: WALLET, salt: SALT, transactionHash: HASH });
  const candidate = loadLocalRecoveryMarker(WALLET);
  assert.equal(candidate?.kind, "candidate");
  if (candidate?.kind === "candidate") assert.equal(candidate.transactionHash, HASH);
});

test("only recognized wallet rejection errors keep prepared recovery resumable", () => {
  assert.equal(isUserRejectedWalletRequest({ code: 4001 }), true);
  assert.equal(isUserRejectedWalletRequest({ cause: { name: "UserRejectedRequestError" } }), true);
  assert.equal(isUserRejectedWalletRequest(new Error("wallet transport failed")), false);
});

test("single-flight latch rejects a second synchronous acquisition", () => {
  const latch = { current: false };
  assert.equal(acquireSingleFlight(latch), true);
  assert.equal(latch.current, true);
  assert.equal(acquireSingleFlight(latch), false);
  latch.current = false;
  assert.equal(acquireSingleFlight(latch), true);
});
