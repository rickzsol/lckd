import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { PONS_FACTORY_ABI } from "./abi";
import { buildPonsLaunchRequest } from "./build";
import {
  PONS_DEX_ID,
  PONS_FACTORY_ADDRESS,
  PONS_LAUNCH_CONFIG_ID,
  PONS_LAUNCH_FEE_WEI,
  PONS_UNISWAP_FACTORY_ADDRESS,
  PONS_WETH_ADDRESS,
} from "./constants";
import type { PonsLaunchParams, PonsLaunchReceipt } from "./types";
import {
  assertPonsDeployment,
  decodePonsLaunchReceipt,
  verifyPonsLaunchReceipt,
} from "./verify";

const DEPLOYER = "0x1111111111111111111111111111111111111111" as Address;
const TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const POOL = "0x3333333333333333333333333333333333333333" as Address;
const SALT = `0x${"ab".repeat(32)}` as const;

function validParams(overrides: Partial<PonsLaunchParams> = {}): PonsLaunchParams {
  return {
    name: "Pons Test",
    symbol: "PONS",
    logo: "https://example.com/token.png",
    description: "A test token",
    socials: { twitter: "https://x.com/pons" },
    feeWallet: DEPLOYER,
    initialBuyWei: BigInt("1000000000000000"),
    salt: SALT,
    ...overrides,
  };
}

test("builds the exact Pons launch request", () => {
  const params = validParams();
  const request = buildPonsLaunchRequest(params);

  assert.equal(request.address, PONS_FACTORY_ADDRESS);
  assert.equal(request.abi, PONS_FACTORY_ABI);
  assert.equal(request.functionName, "launchToken");
  assert.equal(request.value, PONS_LAUNCH_FEE_WEI + params.initialBuyWei);
  assert.equal(request.args[1], PONS_LAUNCH_CONFIG_ID);
  assert.equal(request.args[2], PONS_DEX_ID);
  assert.equal(request.args[3], SALT);
  assert.deepEqual(request.args[0], {
    name: "Pons Test",
    symbol: "PONS",
    logo: "https://example.com/token.png",
    description: "A test token",
    socials: {
      twitter: "https://x.com/pons",
      telegram: "",
      discord: "",
      website: "",
      farcaster: "",
    },
    feeWallet: DEPLOYER,
  });
});

test("rejects invalid launch inputs", () => {
  assert.throws(() => buildPonsLaunchRequest(validParams({ name: " " })), /name is required/);
  assert.throws(() => buildPonsLaunchRequest(validParams({ symbol: "" })), /symbol is required/);
  assert.throws(() => buildPonsLaunchRequest(validParams({ logo: "javascript:alert(1)" })), /unsupported URL protocol/);
  assert.throws(() => buildPonsLaunchRequest(validParams({ description: "" })), /description is required/);
  assert.throws(() => buildPonsLaunchRequest(validParams({ feeWallet: "0x123" as Address })), /fee and buy recipient is invalid/);
  assert.throws(() => buildPonsLaunchRequest(validParams({ initialBuyWei: BigInt(-1) })), /cannot be negative/);
  assert.throws(() => buildPonsLaunchRequest(validParams({ salt: "0xab" })), /salt must be bytes32/);
  assert.throws(
    () => buildPonsLaunchRequest(validParams({ socials: { website: "ftp://example.com" } })),
    /unsupported URL protocol/,
  );
});

function launchLog(receipt: PonsLaunchReceipt) {
  const topics = encodeEventTopics({
    abi: PONS_FACTORY_ABI,
    eventName: "TokenLaunched",
    args: {
      token: receipt.token,
      deployer: receipt.deployer,
      dexFactory: receipt.dexFactory,
    },
  });
  const data = encodeAbiParameters(
    parseAbiParameters("address,address,uint256,uint256,uint256,uint256,uint256"),
    [
      receipt.pairToken,
      receipt.pool,
      receipt.dexId,
      receipt.launchConfigId,
      receipt.positionId,
      receipt.restrictionsEndBlock,
      receipt.initialBuyAmount,
    ],
  );
  const normalizedTopics = topics.filter((topic): topic is Hex => typeof topic === "string");
  return {
    address: PONS_FACTORY_ADDRESS,
    topics: normalizedTopics as [Hex, ...Hex[]],
    data,
  };
}

test("decodes a Pons TokenLaunched receipt", () => {
  const expected: PonsLaunchReceipt = {
    token: TOKEN,
    deployer: DEPLOYER,
    dexFactory: PONS_UNISWAP_FACTORY_ADDRESS,
    pairToken: PONS_WETH_ADDRESS,
    pool: POOL,
    dexId: PONS_DEX_ID,
    launchConfigId: PONS_LAUNCH_CONFIG_ID,
    positionId: BigInt(42),
    restrictionsEndBlock: BigInt(12_345),
    initialBuyAmount: BigInt(99),
  };
  assert.deepEqual(decodePonsLaunchReceipt([launchLog(expected)]), expected);
  assert.throws(() => decodePonsLaunchReceipt([]), /exactly one/);
  assert.throws(() => decodePonsLaunchReceipt([launchLog(expected), launchLog(expected)]), /received 2/);
});

test("deployment assertion fails closed on chain and bytecode drift", async () => {
  const wrongChain = { getChainId: async () => 1 } as unknown as PublicClient;
  await assert.rejects(() => assertPonsDeployment(wrongChain), /chain ID expected 4663, received 1/);

  const missingCode = {
    getChainId: async () => 4_663,
    getCode: async () => undefined,
  } as unknown as PublicClient;
  await assert.rejects(() => assertPonsDeployment(missingCode), /factory has no runtime code/);
});

test("post-receipt verification rejects expected-field mismatches before RPC reads", async () => {
  const receipt: PonsLaunchReceipt = {
    token: TOKEN,
    deployer: DEPLOYER,
    dexFactory: PONS_UNISWAP_FACTORY_ADDRESS,
    pairToken: PONS_WETH_ADDRESS,
    pool: POOL,
    dexId: PONS_DEX_ID,
    launchConfigId: PONS_LAUNCH_CONFIG_ID,
    positionId: BigInt(42),
    restrictionsEndBlock: BigInt(12_345),
    initialBuyAmount: BigInt(99),
  };
  await assert.rejects(
    () => verifyPonsLaunchReceipt({} as PublicClient, receipt, { deployer: DEPLOYER, feeWallet: DEPLOYER, initialBuyWei: BigInt(100) }),
    /receipt initial buy expected 100, received 99/,
  );
});
