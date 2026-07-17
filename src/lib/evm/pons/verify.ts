import {
  decodeEventLog,
  keccak256,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  PONS_FACTORY_ABI,
  PONS_LOCKER_ABI,
  PONS_POSITION_MANAGER_ABI,
  PONS_TOKEN_ABI,
} from "./abi";
import {
  PONS_DEX_ID,
  PONS_DEX_NAME,
  PONS_FACTORY_ADDRESS,
  PONS_GRADUATION_THRESHOLD_WEI,
  PONS_INITIAL_TICK,
  PONS_LAUNCH_CONFIG_ID,
  PONS_LAUNCH_FEE_WEI,
  PONS_LOCKER_ADDRESS,
  PONS_MAX_TX_BPS,
  PONS_MAX_WALLET_BPS,
  PONS_OWNER_ADDRESS,
  PONS_POOL_FEE,
  PONS_POSITION_MANAGER_ADDRESS,
  PONS_PROTOCOL_FEE_SHARE,
  PONS_RESTRICTION_BLOCKS,
  PONS_ROUTER_ADDRESS,
  PONS_RUNTIME_CODE_HASHES,
  PONS_SUPPLY,
  PONS_TICK_SPACING,
  PONS_UNISWAP_FACTORY_ADDRESS,
  PONS_WETH_ADDRESS,
  ROBINHOOD_CHAIN_ID,
  ZERO_ADDRESS,
} from "./constants";
import type {
  PonsDeploymentSnapshot,
  PonsLaunchReceipt,
  PonsReceiptExpectation,
  PonsReceiptLog,
} from "./types";

const TOKEN_LAUNCHED_TOPIC = keccak256(toBytes(
  "TokenLaunched(address,address,address,address,address,uint256,uint256,uint256,uint256,uint256)",
));

function display(value: unknown): string {
  return typeof value === "bigint" ? value.toString() : String(value);
}

function assertExact(label: string, actual: unknown, expected: unknown): void {
  const normalizedActual = typeof actual === "string" ? actual.toLowerCase() : actual;
  const normalizedExpected = typeof expected === "string" ? expected.toLowerCase() : expected;
  if (normalizedActual !== normalizedExpected) {
    throw new Error(`Pons deployment drift: ${label} expected ${display(expected)}, received ${display(actual)}`);
  }
}

async function assertRuntimeCode(
  publicClient: PublicClient,
  label: string,
  address: Address,
  expectedHash: Hex,
): Promise<void> {
  const code = await publicClient.getCode({ address });
  if (!code || code === "0x") throw new Error(`Pons deployment drift: ${label} has no runtime code`);
  assertExact(`${label} runtime code hash`, keccak256(code), expectedHash);
}

export async function assertPonsDeployment(publicClient: PublicClient): Promise<PonsDeploymentSnapshot> {
  assertExact("chain ID", await publicClient.getChainId(), ROBINHOOD_CHAIN_ID);

  const dependencies = [
    ["factory", PONS_FACTORY_ADDRESS, PONS_RUNTIME_CODE_HASHES.factory],
    ["locker", PONS_LOCKER_ADDRESS, PONS_RUNTIME_CODE_HASHES.locker],
    ["WETH", PONS_WETH_ADDRESS, PONS_RUNTIME_CODE_HASHES.weth],
    ["Uniswap factory", PONS_UNISWAP_FACTORY_ADDRESS, PONS_RUNTIME_CODE_HASHES.uniswapFactory],
    ["position manager", PONS_POSITION_MANAGER_ADDRESS, PONS_RUNTIME_CODE_HASHES.positionManager],
    ["router", PONS_ROUTER_ADDRESS, PONS_RUNTIME_CODE_HASHES.router],
  ] as const;
  for (const [label, address, expectedHash] of dependencies) {
    await assertRuntimeCode(publicClient, label, address, expectedHash);
  }

  const [factoryOwner, factoryPendingOwner, locker, launchFee, launchEnabled, dex, launchConfig] =
    await Promise.all([
      publicClient.readContract({ address: PONS_FACTORY_ADDRESS, abi: PONS_FACTORY_ABI, functionName: "owner" }),
      publicClient.readContract({ address: PONS_FACTORY_ADDRESS, abi: PONS_FACTORY_ABI, functionName: "pendingOwner" }),
      publicClient.readContract({ address: PONS_FACTORY_ADDRESS, abi: PONS_FACTORY_ABI, functionName: "locker" }),
      publicClient.readContract({ address: PONS_FACTORY_ADDRESS, abi: PONS_FACTORY_ABI, functionName: "launchFee" }),
      publicClient.readContract({ address: PONS_FACTORY_ADDRESS, abi: PONS_FACTORY_ABI, functionName: "launchEnabled" }),
      publicClient.readContract({ address: PONS_FACTORY_ADDRESS, abi: PONS_FACTORY_ABI, functionName: "getDexConfig", args: [PONS_DEX_ID] }),
      publicClient.readContract({ address: PONS_FACTORY_ADDRESS, abi: PONS_FACTORY_ABI, functionName: "getLaunchConfig", args: [PONS_LAUNCH_CONFIG_ID] }),
    ]);
  const [lockerOwner, lockerPendingOwner, lockerFactory, protocolFeeRecipient, protocolFeeShare] =
    await Promise.all([
      publicClient.readContract({ address: PONS_LOCKER_ADDRESS, abi: PONS_LOCKER_ABI, functionName: "owner" }),
      publicClient.readContract({ address: PONS_LOCKER_ADDRESS, abi: PONS_LOCKER_ABI, functionName: "pendingOwner" }),
      publicClient.readContract({ address: PONS_LOCKER_ADDRESS, abi: PONS_LOCKER_ABI, functionName: "factory" }),
      publicClient.readContract({ address: PONS_LOCKER_ADDRESS, abi: PONS_LOCKER_ABI, functionName: "protocolFeeRecipient" }),
      publicClient.readContract({ address: PONS_LOCKER_ADDRESS, abi: PONS_LOCKER_ABI, functionName: "protocolFeeShare" }),
    ]);

  assertExact("factory owner", factoryOwner, PONS_OWNER_ADDRESS);
  assertExact("factory pending owner", factoryPendingOwner, ZERO_ADDRESS);
  assertExact("factory locker", locker, PONS_LOCKER_ADDRESS);
  assertExact("launch fee", launchFee, PONS_LAUNCH_FEE_WEI);
  assertExact("launch enabled", launchEnabled, true);
  assertExact("locker owner", lockerOwner, PONS_OWNER_ADDRESS);
  assertExact("locker pending owner", lockerPendingOwner, ZERO_ADDRESS);
  assertExact("locker factory", lockerFactory, PONS_FACTORY_ADDRESS);
  assertExact("protocol fee recipient", protocolFeeRecipient, PONS_OWNER_ADDRESS);
  assertExact("protocol fee share", protocolFeeShare, PONS_PROTOCOL_FEE_SHARE);

  assertExact("DEX name", dex.name, PONS_DEX_NAME);
  assertExact("DEX factory", dex.factory, PONS_UNISWAP_FACTORY_ADDRESS);
  assertExact("DEX position manager", dex.positionManager, PONS_POSITION_MANAGER_ADDRESS);
  assertExact("DEX router", dex.swapRouter, PONS_ROUTER_ADDRESS);
  assertExact("DEX pool fee", dex.poolFee, PONS_POOL_FEE);
  assertExact("DEX tick spacing", dex.tickSpacing, PONS_TICK_SPACING);
  assertExact("DEX enabled", dex.enabled, true);

  assertExact("launch pair token", launchConfig.pairToken, PONS_WETH_ADDRESS);
  assertExact("graduation threshold", launchConfig.graduationThreshold, PONS_GRADUATION_THRESHOLD_WEI);
  assertExact("initial tick", launchConfig.initialTick, PONS_INITIAL_TICK);
  assertExact("supply", launchConfig.supply, PONS_SUPPLY);
  assertExact("max wallet BPS", launchConfig.maxWalletBps, PONS_MAX_WALLET_BPS);
  assertExact("max transaction BPS", launchConfig.maxTxBps, PONS_MAX_TX_BPS);
  assertExact("restriction blocks", launchConfig.restrictionBlocks, PONS_RESTRICTION_BLOCKS);
  assertExact("reserved fee", launchConfig.reservedFee, 0);
  assertExact("launch config enabled", launchConfig.enabled, true);
  assertExact("router deadline mode", launchConfig.routerRequiresDeadline, false);

  return {
    factoryOwner,
    lockerOwner,
    protocolFeeRecipient,
    launchFee,
    protocolFeeShare,
    launchEnabled,
    dexName: dex.name,
  };
}

export function decodePonsLaunchReceipt(logs: readonly PonsReceiptLog[]): PonsLaunchReceipt {
  const matchingLogs = logs.filter((log) =>
    log.address.toLowerCase() === PONS_FACTORY_ADDRESS.toLowerCase()
      && log.topics[0]?.toLowerCase() === TOKEN_LAUNCHED_TOPIC,
  );
  if (matchingLogs.length !== 1) {
    throw new Error(`Expected exactly one Pons TokenLaunched event, received ${matchingLogs.length}`);
  }
  const decoded = decodeEventLog({
    abi: PONS_FACTORY_ABI,
    eventName: "TokenLaunched",
    data: matchingLogs[0].data,
    topics: matchingLogs[0].topics,
  });
  return decoded.args;
}

export async function verifyPonsLaunchReceipt(
  publicClient: PublicClient,
  receipt: PonsLaunchReceipt,
  expected: PonsReceiptExpectation,
): Promise<PonsLaunchReceipt> {
  assertExact("receipt deployer", receipt.deployer, expected.deployer);
  assertExact("receipt initial buy", receipt.initialBuyAmount, expected.initialBuyWei);
  assertExact("receipt DEX factory", receipt.dexFactory, PONS_UNISWAP_FACTORY_ADDRESS);
  assertExact("receipt pair token", receipt.pairToken, PONS_WETH_ADDRESS);
  assertExact("receipt DEX ID", receipt.dexId, PONS_DEX_ID);
  assertExact("receipt launch config ID", receipt.launchConfigId, PONS_LAUNCH_CONFIG_ID);

  const code = await publicClient.getCode({ address: receipt.token });
  if (!code || code === "0x") throw new Error("Pons launch verification failed: token has no runtime code");
  const [record, supply, deployer, launchFactory, positionManager, pairToken, poolFee, restrictionEndBlock, pool, nftOwner, feeShare, feeRedirect] =
    await Promise.all([
      publicClient.readContract({ address: PONS_FACTORY_ADDRESS, abi: PONS_FACTORY_ABI, functionName: "getLaunchedToken", args: [receipt.token] }),
      publicClient.readContract({ address: receipt.token, abi: PONS_TOKEN_ABI, functionName: "totalSupply" }),
      publicClient.readContract({ address: receipt.token, abi: PONS_TOKEN_ABI, functionName: "deployer" }),
      publicClient.readContract({ address: receipt.token, abi: PONS_TOKEN_ABI, functionName: "launchFactory" }),
      publicClient.readContract({ address: receipt.token, abi: PONS_TOKEN_ABI, functionName: "positionManager" }),
      publicClient.readContract({ address: receipt.token, abi: PONS_TOKEN_ABI, functionName: "pairToken" }),
      publicClient.readContract({ address: receipt.token, abi: PONS_TOKEN_ABI, functionName: "poolFee" }),
      publicClient.readContract({ address: receipt.token, abi: PONS_TOKEN_ABI, functionName: "restrictionEndBlock" }),
      publicClient.readContract({ address: receipt.token, abi: PONS_TOKEN_ABI, functionName: "liquidityPool" }),
      publicClient.readContract({ address: PONS_POSITION_MANAGER_ADDRESS, abi: PONS_POSITION_MANAGER_ABI, functionName: "ownerOf", args: [receipt.positionId] }),
      publicClient.readContract({ address: PONS_LOCKER_ADDRESS, abi: PONS_LOCKER_ABI, functionName: "tokenProtocolFeeShares", args: [receipt.token] }),
      publicClient.readContract({ address: PONS_LOCKER_ADDRESS, abi: PONS_LOCKER_ABI, functionName: "feeRedirects", args: [receipt.token] }),
    ]);

  assertExact("factory record exists", record.exists, true);
  assertExact("factory record token", record.token, receipt.token);
  assertExact("factory record deployer", record.deployer, expected.deployer);
  assertExact("factory record pair token", record.pairedToken, PONS_WETH_ADDRESS);
  assertExact("factory record position manager", record.positionManager, PONS_POSITION_MANAGER_ADDRESS);
  assertExact("factory record position ID", record.positionId, receipt.positionId);
  assertExact("factory record DEX ID", record.dexId, PONS_DEX_ID);
  assertExact("factory record launch config ID", record.launchConfigId, PONS_LAUNCH_CONFIG_ID);
  assertExact("factory record restriction end block", record.restrictionsEndBlock, receipt.restrictionsEndBlock);
  assertExact("factory record supply", record.supply, PONS_SUPPLY);
  assertExact("factory record pool fee", record.poolFee, PONS_POOL_FEE);
  assertExact("factory record initial buy", record.initialBuyAmount, expected.initialBuyWei);
  assertExact("token total supply", supply, PONS_SUPPLY);
  assertExact("token deployer", deployer, expected.deployer);
  assertExact("token launch factory", launchFactory, PONS_FACTORY_ADDRESS);
  assertExact("token position manager", positionManager, PONS_POSITION_MANAGER_ADDRESS);
  assertExact("token pair token", pairToken, PONS_WETH_ADDRESS);
  assertExact("token pool fee", poolFee, PONS_POOL_FEE);
  assertExact("token restriction end block", restrictionEndBlock, receipt.restrictionsEndBlock);
  assertExact("token liquidity pool", pool, receipt.pool);
  assertExact("LP NFT owner", nftOwner, PONS_LOCKER_ADDRESS);
  assertExact("token protocol fee share", feeShare, PONS_PROTOCOL_FEE_SHARE);
  assertExact("creator fee and initial buy recipient", feeRedirect, expected.feeWallet);
  return receipt;
}
