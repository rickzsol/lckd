import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import {
  isAddress,
  keccak256,
  parseEther,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

import {
  PONS_DEX_ID,
  PONS_FACTORY_ABI,
  PONS_FACTORY_ADDRESS,
  PONS_LAUNCH_CONFIG_ID,
  PONS_LAUNCH_FEE_WEI,
  PONS_LOCKER_ABI,
  PONS_LOCKER_ADDRESS,
  PONS_POSITION_MANAGER_ABI,
  PONS_POSITION_MANAGER_ADDRESS,
  PONS_PROTOCOL_FEE_SHARE,
  PONS_SUPPLY,
  PONS_TOKEN_ABI,
  PONS_UNISWAP_FACTORY_ADDRESS,
  PONS_WETH_ADDRESS,
  ROBINHOOD_CHAIN_ID,
  ZERO_ADDRESS,
  assertPonsDeployment,
  buildPonsLaunchRequest,
  decodePonsLaunchReceipt,
  verifyPonsLaunchReceipt,
  type PonsLaunchReceipt,
} from "../../src/lib/evm/pons/index.js";
import { ponsRecoveryKey } from "./ponsRecovery.fixture.js";

const INITIAL_BUY_WEI = parseEther("0.005");
const HTTPS_LOGO = "https://example.com/lckd-robinhood-fork.png";

function saltFor(label: string): Hex {
  return keccak256(stringToHex(`lckd-pons-fork:${label}:v1`));
}

function assertAddress(label: string, address: Address): void {
  assert.equal(isAddress(address, { strict: true }), true, `${label} must be an address`);
  assert.notEqual(address.toLowerCase(), ZERO_ADDRESS, `${label} must not be zero`);
}

describe("Pons launches on a pinned Robinhood Chain fork", async () => {
  const { viem } = await network.create("robinhoodFork");
  const publicClient = await viem.getPublicClient();
  const testClient = await viem.getTestClient();
  const [launcher, attacker] = await viem.getWalletClients();

  // A generic EDR fork has no historical hardfork schedule for its pinned head.
  // Mine one local block so calls execute against current EVM rules and pinned state.
  await testClient.mine({ blocks: 1 });

  async function launch(
    label: string,
    initialBuyWei: bigint,
    feeWallet: Address = launcher.account.address,
  ): Promise<PonsLaunchReceipt> {
    const request = buildPonsLaunchRequest({
      name: `LCKD Fork ${label}`,
      symbol: label,
      logo: HTTPS_LOGO,
      description: "Deterministic Robinhood Chain fork verification token.",
      socials: {},
      feeWallet,
      initialBuyWei,
      salt: saltFor(label),
    });
    const hash = await launcher.writeContract({
      ...request,
      account: launcher.account,
    });
    const transactionReceipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(transactionReceipt.status, "success");

    const launchReceipt = decodePonsLaunchReceipt(transactionReceipt.logs);
    return verifyPonsLaunchReceipt(publicClient, launchReceipt, {
      deployer: launcher.account.address,
      feeWallet,
      initialBuyWei,
    });
  }

  it("pins the live deployment bytecode and configuration", async () => {
    assert.equal(await publicClient.getChainId(), ROBINHOOD_CHAIN_ID);
    const deployment = await assertPonsDeployment(publicClient);
    assert.equal(deployment.launchEnabled, true);
    assert.equal(deployment.launchFee, PONS_LAUNCH_FEE_WEI);
    assert.equal(deployment.protocolFeeShare, PONS_PROTOCOL_FEE_SHARE);
  });

  it("atomically launches, buys, records, and locks liquidity in the pinned locker", async () => {
    const receipt = await launch("LCKDBUY", INITIAL_BUY_WEI, attacker.account.address);

    assertAddress("token", receipt.token);
    assertAddress("pool", receipt.pool);
    assert.equal(receipt.deployer.toLowerCase(), launcher.account.address.toLowerCase());
    assert.equal(receipt.dexFactory.toLowerCase(), PONS_UNISWAP_FACTORY_ADDRESS.toLowerCase());
    assert.equal(receipt.pairToken.toLowerCase(), PONS_WETH_ADDRESS.toLowerCase());
    assert.equal(receipt.dexId, PONS_DEX_ID);
    assert.equal(receipt.launchConfigId, PONS_LAUNCH_CONFIG_ID);
    assert.ok(receipt.positionId > BigInt(0));
    assert.ok(receipt.restrictionsEndBlock > BigInt(0));
    assert.equal(receipt.initialBuyAmount, INITIAL_BUY_WEI);

    const [totalSupply, decimals, recipientBalance, record, nftOwner, feeShare, feeRedirect] =
      await Promise.all([
        publicClient.readContract({
          address: receipt.token,
          abi: PONS_TOKEN_ABI,
          functionName: "totalSupply",
        }),
        publicClient.readContract({
          address: receipt.token,
          abi: PONS_TOKEN_ABI,
          functionName: "decimals",
        }),
        publicClient.readContract({
          address: receipt.token,
          abi: PONS_TOKEN_ABI,
          functionName: "balanceOf",
          args: [attacker.account.address],
        }),
        publicClient.readContract({
          address: PONS_FACTORY_ADDRESS,
          abi: PONS_FACTORY_ABI,
          functionName: "getLaunchedToken",
          args: [receipt.token],
        }),
        publicClient.readContract({
          address: PONS_POSITION_MANAGER_ADDRESS,
          abi: PONS_POSITION_MANAGER_ABI,
          functionName: "ownerOf",
          args: [receipt.positionId],
        }),
        publicClient.readContract({
          address: PONS_LOCKER_ADDRESS,
          abi: PONS_LOCKER_ABI,
          functionName: "tokenProtocolFeeShares",
          args: [receipt.token],
        }),
        publicClient.readContract({
          address: PONS_LOCKER_ADDRESS,
          abi: PONS_LOCKER_ABI,
          functionName: "feeRedirects",
          args: [receipt.token],
        }),
      ]);

    assert.equal(totalSupply, PONS_SUPPLY);
    assert.equal(decimals, 18);
    assert.ok(recipientBalance > BigInt(0));
    assert.equal(record.exists, true);
    assert.equal(record.token.toLowerCase(), receipt.token.toLowerCase());
    assert.equal(record.positionId, receipt.positionId);
    assert.equal(nftOwner.toLowerCase(), PONS_LOCKER_ADDRESS.toLowerCase());
    assert.equal(feeShare, PONS_PROTOCOL_FEE_SHARE);
    assert.equal(feeRedirect.toLowerCase(), attacker.account.address.toLowerCase());

    await assert.rejects(
      attacker.writeContract({
        address: PONS_POSITION_MANAGER_ADDRESS,
        abi: PONS_POSITION_MANAGER_ABI,
        functionName: "safeTransferFrom",
        args: [PONS_LOCKER_ADDRESS, attacker.account.address, receipt.positionId],
        account: attacker.account,
      }),
    );

  });

  it("launches and locks liquidity without an initial buy", async () => {
    const receipt = await launch("LCKDZERO", BigInt(0));
    assert.equal(receipt.initialBuyAmount, BigInt(0));

    const creatorBalance = await publicClient.readContract({
      address: receipt.token,
      abi: PONS_TOKEN_ABI,
      functionName: "balanceOf",
      args: [launcher.account.address],
    });
    assert.equal(creatorBalance, BigInt(0));
  });

  it("makes an identical payable launch retry idempotent on-chain", async () => {
    const salt = saltFor("LCKDRETRY");
    const request = buildPonsLaunchRequest({
      name: "LCKD Fork LCKDRETRY",
      symbol: "LCKDRETRY",
      logo: HTTPS_LOGO,
      description: "Deterministic Robinhood Chain fork verification token.",
      socials: {},
      feeWallet: launcher.account.address,
      initialBuyWei: INITIAL_BUY_WEI,
      salt,
    });
    const recoveryContract = {
      chainId: ROBINHOOD_CHAIN_ID,
      factory: PONS_FACTORY_ADDRESS,
      launcher: launcher.account.address,
      salt,
    } as const;
    assert.equal(ponsRecoveryKey(recoveryContract), ponsRecoveryKey({ ...recoveryContract }));

    const deployment = await assertPonsDeployment(publicClient);
    const firstBlock = await publicClient.getBlockNumber();
    const launcherBalanceBefore = await publicClient.getBalance({
      address: launcher.account.address,
    });
    const protocolBalanceBefore = await publicClient.getBalance({
      address: deployment.protocolFeeRecipient,
    });

    const firstHash = await launcher.writeContract({
      ...request,
      account: launcher.account,
    });
    const firstTransaction = await publicClient.waitForTransactionReceipt({ hash: firstHash });
    assert.equal(firstTransaction.status, "success");
    const receipt = decodePonsLaunchReceipt(firstTransaction.logs);
    await verifyPonsLaunchReceipt(publicClient, receipt, {
      deployer: launcher.account.address,
      feeWallet: launcher.account.address,
      initialBuyWei: INITIAL_BUY_WEI,
    });

    const launcherBalanceAfterFirst = await publicClient.getBalance({
      address: launcher.account.address,
    });
    const expectedFirstImpact = request.value
      + firstTransaction.gasUsed * firstTransaction.effectiveGasPrice;
    assert.equal(launcherBalanceBefore - launcherBalanceAfterFirst, expectedFirstImpact);
    assert.equal(
      await publicClient.getBalance({ address: deployment.protocolFeeRecipient }),
      protocolBalanceBefore + PONS_LAUNCH_FEE_WEI,
    );
    const initialTokenBalance = await publicClient.readContract({
      address: receipt.token,
      abi: PONS_TOKEN_ABI,
      functionName: "balanceOf",
      args: [launcher.account.address],
    });
    assert.ok(initialTokenBalance > BigInt(0));

    const balanceBeforeRetry = await publicClient.getBalance({
      address: launcher.account.address,
    });
    const protocolBalanceBeforeRetry = await publicClient.getBalance({
      address: deployment.protocolFeeRecipient,
    });
    await assert.rejects(
      launcher.writeContract({
        ...request,
        account: launcher.account,
      }),
    );

    assert.equal(
      await publicClient.getBalance({ address: launcher.account.address }),
      balanceBeforeRetry,
    );
    assert.equal(
      await publicClient.getBalance({ address: deployment.protocolFeeRecipient }),
      protocolBalanceBeforeRetry,
    );
    assert.equal(
      await publicClient.readContract({
        address: receipt.token,
        abi: PONS_TOKEN_ABI,
        functionName: "balanceOf",
        args: [launcher.account.address],
      }),
      initialTokenBalance,
    );

    const record = await publicClient.readContract({
      address: PONS_FACTORY_ADDRESS,
      abi: PONS_FACTORY_ABI,
      functionName: "getLaunchedToken",
      args: [receipt.token],
    });
    assert.equal(record.exists, true);
    assert.equal(record.token.toLowerCase(), receipt.token.toLowerCase());
    assert.equal(record.positionId, receipt.positionId);

    const launchEvents = await publicClient.getContractEvents({
      address: PONS_FACTORY_ADDRESS,
      abi: PONS_FACTORY_ABI,
      eventName: "TokenLaunched",
      fromBlock: firstBlock,
      toBlock: "latest",
      strict: true,
    });
    const matchingEvents = launchEvents.filter((event) =>
      event.args.token.toLowerCase() === receipt.token.toLowerCase()
        && event.args.deployer.toLowerCase() === launcher.account.address.toLowerCase(),
    );
    assert.equal(matchingEvents.length, 1);
  });

  it("settles only one of two identical broadcasts queued before mining", async () => {
    const salt = saltFor("LCKDRACE");
    const request = buildPonsLaunchRequest({
      name: "LCKD Fork LCKDRACE",
      symbol: "LCKDRACE",
      logo: HTTPS_LOGO,
      description: "Concurrent lost-response recovery fork verification token.",
      socials: {},
      feeWallet: launcher.account.address,
      initialBuyWei: INITIAL_BUY_WEI,
      salt,
    });
    const deployment = await assertPonsDeployment(publicClient);
    const firstBlock = await publicClient.getBlockNumber();
    const nonce = await publicClient.getTransactionCount({
      address: launcher.account.address,
      blockTag: "pending",
    });
    const gas = await publicClient.estimateContractGas({
      ...request,
      account: launcher.account.address,
    });
    const launcherBalanceBefore = await publicClient.getBalance({
      address: launcher.account.address,
    });
    const protocolBalanceBefore = await publicClient.getBalance({
      address: deployment.protocolFeeRecipient,
    });

    let firstHash: Hex | undefined;
    let retryHash: Hex | undefined;
    await testClient.setAutomine(false);
    try {
      firstHash = await launcher.writeContract({
        ...request,
        account: launcher.account,
        gas,
        nonce,
      });
      retryHash = await launcher.writeContract({
        ...request,
        account: launcher.account,
        gas,
        nonce: nonce + 1,
      });
      await testClient.mine({ blocks: 1 });
    } finally {
      await testClient.setAutomine(true);
    }

    assert.ok(firstHash);
    assert.ok(retryHash);
    const [firstTransaction, retryTransaction] = await Promise.all([
      publicClient.getTransactionReceipt({ hash: firstHash }),
      publicClient.getTransactionReceipt({ hash: retryHash }),
    ]);
    assert.equal(firstTransaction.status, "success");
    assert.equal(retryTransaction.status, "reverted");

    const receipt = decodePonsLaunchReceipt(firstTransaction.logs);
    await verifyPonsLaunchReceipt(publicClient, receipt, {
      deployer: launcher.account.address,
      feeWallet: launcher.account.address,
      initialBuyWei: INITIAL_BUY_WEI,
    });
    assert.throws(() => decodePonsLaunchReceipt(retryTransaction.logs));

    const firstGasCost = firstTransaction.gasUsed * firstTransaction.effectiveGasPrice;
    const retryGasCost = retryTransaction.gasUsed * retryTransaction.effectiveGasPrice;
    assert.equal(
      launcherBalanceBefore
        - await publicClient.getBalance({ address: launcher.account.address }),
      request.value + firstGasCost + retryGasCost,
    );
    assert.equal(
      await publicClient.getBalance({ address: deployment.protocolFeeRecipient }),
      protocolBalanceBefore + PONS_LAUNCH_FEE_WEI,
    );

    const [record, creatorBalance, launchEvents] = await Promise.all([
      publicClient.readContract({
        address: PONS_FACTORY_ADDRESS,
        abi: PONS_FACTORY_ABI,
        functionName: "getLaunchedToken",
        args: [receipt.token],
      }),
      publicClient.readContract({
        address: receipt.token,
        abi: PONS_TOKEN_ABI,
        functionName: "balanceOf",
        args: [launcher.account.address],
      }),
      publicClient.getContractEvents({
        address: PONS_FACTORY_ADDRESS,
        abi: PONS_FACTORY_ABI,
        eventName: "TokenLaunched",
        fromBlock: firstBlock,
        toBlock: "latest",
        strict: true,
      }),
    ]);
    assert.equal(record.exists, true);
    assert.equal(record.token.toLowerCase(), receipt.token.toLowerCase());
    assert.ok(creatorBalance > BigInt(0));
    assert.equal(
      launchEvents.filter((event) =>
        event.args.token.toLowerCase() === receipt.token.toLowerCase()
          && event.args.deployer.toLowerCase() === launcher.account.address.toLowerCase(),
      ).length,
      1,
    );
  });

  it("rejects an underfunded launch and detects chain drift", async () => {
    const underfunded = buildPonsLaunchRequest({
      name: "Underfunded Fork Launch",
      symbol: "NOFEE",
      logo: HTTPS_LOGO,
      description: "Expected to fail before deployment.",
      feeWallet: launcher.account.address,
      initialBuyWei: BigInt(0),
      salt: saltFor("NOFEE"),
    });
    await assert.rejects(
      launcher.writeContract({
        ...underfunded,
        value: PONS_LAUNCH_FEE_WEI - BigInt(1),
        account: launcher.account,
      }),
    );

    const wrongChainClient = new Proxy(publicClient, {
      get(target, property, receiver) {
        if (property === "getChainId") return async () => 1;
        return Reflect.get(target, property, receiver);
      },
    });
    await assert.rejects(
      assertPonsDeployment(wrongChainClient),
      /Pons deployment drift: chain ID/,
    );
  });
});
