import assert from "node:assert/strict";
import test from "node:test";
import { TransactionNotFoundError, encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import {
  PONS_FACTORY_ADDRESS,
  ROBINHOOD_CHAIN_ID,
  buildPonsLaunchRequest,
} from "@/lib/evm/pons";
import {
  RobinhoodRecoveryError,
  assertRobinhoodTransactionMatches,
  isSameRobinhoodIntent,
  normalizeRobinhoodHash,
  normalizeRobinhoodIntent,
  robinhoodIntentResponse,
  type RobinhoodLaunchConfig,
  type RobinhoodTransaction,
} from "./robinhoodLaunchRecoverySchema";
import {
  ROBINHOOD_REQUIRED_CONFIRMATIONS,
  hasRequiredConfirmations,
  prevalidateCheckpointTransaction,
  shouldFailAfterReplacementScan,
} from "./robinhoodLaunchRecoveryDiscovery";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const FEE_WALLET = "0x2222222222222222222222222222222222222222" as Address;
const SALT = `0x${"AB".repeat(32)}` as Hex;
const HASH = `0x${"CD".repeat(32)}` as Hex;

function validConfig(overrides: Partial<RobinhoodLaunchConfig> = {}) {
  return {
    name: " Robin Hood ",
    symbol: "hood",
    description: " A permanently locked launch ",
    logo: "ipfs://bafybeigdyrzt",
    twitter: "https://x.com/robinhood",
    telegram: "",
    website: "https://example.com",
    initialBuyEth: "0.005",
    feeWallet: FEE_WALLET.toUpperCase().replace("0X", "0x"),
    hasAcceptedPermanentLock: true,
    ...overrides,
  };
}

test("normalizes and validates a prepared Robinhood intent", () => {
  const intent = normalizeRobinhoodIntent({ walletAddress: WALLET, salt: SALT, config: validConfig() });
  assert.equal(intent.walletAddress, WALLET);
  assert.equal(intent.salt, SALT.toLowerCase());
  assert.equal(intent.config.name, "Robin Hood");
  assert.equal(intent.config.symbol, "HOOD");
  assert.equal(intent.config.description, "A permanently locked launch");
  assert.equal(intent.config.feeWallet, FEE_WALLET);
  assert.equal(intent.initialBuyWei, BigInt("5000000000000000"));
});

test("rejects unsafe or noncanonical launch config", () => {
  const normalize = (config: unknown) => normalizeRobinhoodIntent({ walletAddress: WALLET, salt: SALT, config });
  assert.throws(() => normalize(validConfig({ hasAcceptedPermanentLock: false as true })), /acceptance is required/);
  assert.throws(() => normalize(validConfig({ logo: "" })), /Logo is required/);
  assert.throws(() => normalize(validConfig({ logo: "http://example.com/logo.png" })), /valid HTTPS URL/);
  assert.throws(() => normalize(validConfig({ twitter: "javascript:alert(1)" })), /valid HTTPS URL/);
  assert.throws(() => normalize(validConfig({ symbol: "NOT_OK" })), /Invalid token symbol/);
  assert.throws(() => normalize(validConfig({ initialBuyEth: "0.0000000000000000001" })), /Invalid initial buy/);
  assert.throws(() => normalize({ ...validConfig(), unexpected: true }), /unsupported fields/);
  assert.throws(
    () => normalizeRobinhoodIntent({ walletAddress: "0x0000000000000000000000000000000000000000", salt: SALT, config: validConfig() }),
    /cannot be zero/,
  );
});

test("normalizes transaction hashes and rejects malformed hashes", () => {
  assert.equal(normalizeRobinhoodHash(HASH), HASH.toLowerCase());
  assert.throws(() => normalizeRobinhoodHash("0x1234"), /must be bytes32/);
});

test("compares idempotent intents independently of JSONB key order", () => {
  const intent = normalizeRobinhoodIntent({ walletAddress: WALLET, salt: SALT, config: validConfig() });
  const reversedConfig = Object.fromEntries(Object.entries(intent.config).reverse()) as unknown as RobinhoodLaunchConfig;
  const row = {
    id: "intent-id",
    github_id: "1",
    wallet_address: WALLET,
    salt: intent.salt,
    config: reversedConfig,
    initial_buy_wei: intent.initialBuyWei.toString(),
    prepared_block_number: 12_000_000,
    last_scanned_block: 11_999_999,
    transaction_hash: null,
    token_address: null,
    pool_address: null,
    position_id: null,
    failure_reason: null,
    status: "prepared" as const,
    expires_at: new Date().toISOString(),
  };
  assert.equal(isSameRobinhoodIntent(row, intent), true);
  assert.equal(isSameRobinhoodIntent({ ...row, initial_buy_wei: "1" }, intent), false);
});

function matchingTransaction() {
  const intent = normalizeRobinhoodIntent({ walletAddress: WALLET, salt: SALT, config: validConfig() });
  const request = buildPonsLaunchRequest({
    name: intent.config.name,
    symbol: intent.config.symbol,
    description: intent.config.description,
    logo: intent.config.logo,
    socials: {
      twitter: intent.config.twitter,
      telegram: intent.config.telegram,
      website: intent.config.website,
    },
    feeWallet: intent.config.feeWallet as Address,
    initialBuyWei: intent.initialBuyWei,
    salt: intent.salt,
  });
  const transaction: RobinhoodTransaction = {
    chainId: ROBINHOOD_CHAIN_ID,
    from: WALLET,
    to: PONS_FACTORY_ADDRESS,
    value: request.value,
    input: encodeFunctionData(request),
  };
  return { intent, transaction };
}

test("requires exact chain, sender, factory, value, and calldata", () => {
  const { intent, transaction } = matchingTransaction();
  assert.doesNotThrow(() => assertRobinhoodTransactionMatches(transaction, intent));
  const mismatches: Array<[Partial<RobinhoodTransaction>, RegExp]> = [
    [{ chainId: 1 }, /chain ID/],
    [{ from: FEE_WALLET }, /sender/],
    [{ to: FEE_WALLET }, /factory/],
    [{ value: transaction.value + BigInt(1) }, /value/],
    [{ input: "0x1234" }, /calldata/],
  ];
  for (const [change, message] of mismatches) {
    assert.throws(
      () => assertRobinhoodTransactionMatches({ ...transaction, ...change }, intent),
      (error) => error instanceof RobinhoodRecoveryError && error.status === 422 && message.test(error.message),
    );
  }
});

test("prevalidates a checkpoint hash before service persistence", async () => {
  const { intent, transaction } = matchingTransaction();
  const client = {
    getTransaction: async () => transaction,
    getChainId: async () => ROBINHOOD_CHAIN_ID,
  } as unknown as PublicClient;
  assert.equal(await prevalidateCheckpointTransaction(client, HASH, intent), "exact");

  const mismatchClient = {
    getTransaction: async () => ({ ...transaction, value: transaction.value + BigInt(1) }),
    getChainId: async () => ROBINHOOD_CHAIN_ID,
  } as unknown as PublicClient;
  assert.equal(await prevalidateCheckpointTransaction(mismatchClient, HASH, intent), "mismatch");

  const missingClient = {
    getTransaction: async () => { throw new TransactionNotFoundError({ hash: HASH }); },
  } as unknown as PublicClient;
  assert.equal(await prevalidateCheckpointTransaction(missingClient, HASH, intent), "missing");
});

test("requires 20 confirmations and fails only definitive unreplaced transactions", () => {
  const receiptBlock = BigInt(1_000);
  assert.equal(ROBINHOOD_REQUIRED_CONFIRMATIONS, BigInt(20));
  assert.equal(hasRequiredConfirmations(receiptBlock + BigInt(18), receiptBlock), false);
  assert.equal(hasRequiredConfirmations(receiptBlock + BigInt(19), receiptBlock), true);
  assert.equal(shouldFailAfterReplacementScan("reverted", true, false), true);
  assert.equal(shouldFailAfterReplacementScan("mismatch", true, false), true);
  assert.equal(shouldFailAfterReplacementScan("reverted", false, false), false);
  assert.equal(shouldFailAfterReplacementScan("reverted", true, true), false);
  assert.equal(shouldFailAfterReplacementScan("missing", true, false), false);
  assert.equal(shouldFailAfterReplacementScan("pending", true, false), false);
});

test("serializes durable ambiguous intents without a client transaction claim", () => {
  const intent = normalizeRobinhoodIntent({ walletAddress: WALLET, salt: SALT, config: validConfig() });
  const response = robinhoodIntentResponse({
    id: "ambiguous-id",
    github_id: "1",
    wallet_address: WALLET,
    salt: intent.salt,
    config: intent.config,
    initial_buy_wei: intent.initialBuyWei.toString(),
    prepared_block_number: 12_000_000,
    last_scanned_block: 11_999_999,
    transaction_hash: null,
    token_address: null,
    pool_address: null,
    position_id: null,
    failure_reason: null,
    status: "ambiguous",
    expires_at: new Date(0).toISOString(),
  });
  assert.equal(response.status, "ambiguous");
  assert.equal(response.transactionHash, null);
  assert.equal(response.error, null);
});

test("maps persisted rows to the frozen public response", () => {
  const response = robinhoodIntentResponse({
    id: "intent-id",
    github_id: "1",
    wallet_address: WALLET,
    salt: SALT.toLowerCase(),
    config: normalizeRobinhoodIntent({ walletAddress: WALLET, salt: SALT, config: validConfig() }).config,
    initial_buy_wei: "5000000000000000",
    prepared_block_number: 12_000_000,
    last_scanned_block: 11_999_999,
    transaction_hash: null,
    token_address: null,
    pool_address: null,
    position_id: null,
    failure_reason: null,
    status: "prepared",
    expires_at: new Date().toISOString(),
  });
  assert.equal(response.transactionHash, null);
  assert.equal(response.tokenAddress, null);
  assert.equal(response.poolAddress, null);
  assert.equal(response.positionId, null);
  assert.equal(response.error, null);
});
