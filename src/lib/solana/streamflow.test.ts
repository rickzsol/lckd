import assert from "node:assert/strict";
import test from "node:test";
import { Connection, Keypair } from "@solana/web3.js";
import {
  buildStreamType,
  calculateUnlockedAmount,
  ICluster,
  isTokenLock,
  StreamType,
} from "@streamflow/stream";
import BN from "bn.js";
import {
  calculateLockAmount,
  createStreamflowLockData,
  getConfirmedClusterTimestamp,
  resolveStreamflowCluster,
} from "./streamflow";

test("v13 lock data matches Streamflow token-lock invariants", () => {
  const sender = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const amount = new BN("998103");
  const now = 1_800_000_000;
  const durationSeconds = 86_400;
  const { streamData, unlockTimestamp } = createStreamflowLockData(
    { sender, mint, amount, durationSeconds, tokenName: "Locked token" },
    now,
  );

  assert.equal(unlockTimestamp, now + durationSeconds);
  assert.equal(streamData.recipient, sender.toBase58());
  assert.equal(streamData.tokenId, mint.toBase58());
  assert(streamData.amount.eq(amount));
  assert.equal(streamData.start, unlockTimestamp);
  assert.equal(streamData.cliff, unlockTimestamp);
  assert.equal(streamData.period, 1);
  assert(streamData.cliffAmount.eq(amount));
  assert(streamData.amountPerPeriod.eqn(1));
  assert.equal(streamData.canTopup, false);
  assert.equal(streamData.cancelableBySender, false);
  assert.equal(streamData.cancelableByRecipient, false);
  assert.equal(streamData.transferableBySender, false);
  assert.equal(streamData.transferableByRecipient, false);
  assert.equal(streamData.automaticWithdrawal, false);
  assert.equal(streamData.withdrawalFrequency, 0);
  assert.equal(streamData.canPause, false);
  assert.equal(streamData.canUpdateRate, false);
  const classificationData = {
    canTopup: streamData.canTopup ?? false,
    automaticWithdrawal: streamData.automaticWithdrawal ?? false,
    cancelableBySender: streamData.cancelableBySender ?? false,
    cancelableByRecipient: streamData.cancelableByRecipient ?? false,
    transferableBySender: streamData.transferableBySender ?? false,
    transferableByRecipient: streamData.transferableByRecipient ?? false,
    depositedAmount: amount,
    cliffAmount: streamData.cliffAmount,
    cliff: streamData.cliff,
    end: unlockTimestamp + 1,
  };
  assert.equal(isTokenLock(classificationData), true);
  assert.equal(buildStreamType(classificationData), StreamType.Lock);

  const schedule = {
    depositedAmount: amount,
    cliff: streamData.cliff,
    cliffAmount: streamData.cliffAmount,
    end: unlockTimestamp + 1,
    lastRateChangeTime: 0,
    period: streamData.period,
    amountPerPeriod: streamData.amountPerPeriod,
    fundsUnlockedAtLastRateChange: new BN(0),
  };
  const unlockedBeforeCliff = calculateUnlockedAmount({
    ...schedule,
    currentTimestamp: unlockTimestamp - 1,
  });
  const unlockedAtCliff = calculateUnlockedAmount({
    ...schedule,
    currentTimestamp: unlockTimestamp,
  });
  assert(unlockedBeforeCliff.isZero());
  assert(unlockedAtCliff.eq(amount));
});

test("lock amount represents the actual deposited percentage", () => {
  const totalBalance = BigInt(1_000_000);
  const totalFeePercent = 0.19;
  const amount = calculateLockAmount(totalBalance, 99, totalFeePercent);
  const totalDebit =
    BigInt(amount.toString()) +
    (BigInt(amount.toString()) * BigInt(19) + BigInt(9_999)) / BigInt(10_000);

  assert.equal(amount.toString(), "990000");
  assert(totalDebit <= totalBalance);
  assert.throws(
    () => calculateLockAmount(totalBalance, 100, totalFeePercent),
    /insufficient tokens/,
  );
});

test("lock schedule time comes from confirmed Solana blocks", async () => {
  const clusterTimestamp = 1_800_000_000;
  const connection = {
    getSlot: async () => 100,
    getBlockTime: async (slot: number) =>
      slot === 100 ? null : clusterTimestamp,
  } as unknown as Connection;

  assert.equal(await getConfirmedClusterTimestamp(connection), clusterTimestamp);
});

test("cluster selection rejects an explicit RPC mismatch", () => {
  assert.equal(
    resolveStreamflowCluster("https://devnet.helius-rpc.com", "devnet"),
    ICluster.Devnet,
  );
  assert.throws(
    () => resolveStreamflowCluster("https://devnet.helius-rpc.com", "mainnet"),
    /does not match RPC endpoint/,
  );
});
