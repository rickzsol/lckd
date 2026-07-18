import "server-only";

import { BaseError, createPublicClient, http, type Address, type Hash, type Hex } from "viem";
import { ROBINHOOD_RPC_URL, decodePonsLaunchReceipt, robinhoodChain, verifyPonsLaunchReceipt } from "@/lib/evm/pons";
import {
  hasRequiredConfirmations,
  inspectKnownTransaction,
  prevalidateCheckpointTransaction,
  scanForExactLaunch,
  shouldFailAfterReplacementScan,
  type LaunchCandidate,
} from "./robinhoodLaunchRecoveryDiscovery";
import {
  RobinhoodRecoveryError,
  RobinhoodRetryableError,
  isSameRobinhoodIntent,
  normalizeRobinhoodIntent,
  type NormalizedRobinhoodIntent,
  type RobinhoodIntentRow,
} from "./robinhoodLaunchRecoverySchema";

export * from "./robinhoodLaunchRecoveryDiscovery";
export * from "./robinhoodLaunchRecoverySchema";

function publicClient() {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(process.env.ROBINHOOD_RPC_URL ?? ROBINHOOD_RPC_URL),
  });
}

async function serverClient() {
  const { getServerClient } = await import("@/lib/supabase");
  return getServerClient();
}

async function findIntent(githubId: string, wallet: Address, salt?: Hex) {
  let query = (await serverClient()).from("robinhood_launch_intents").select("*")
    .eq("github_id", githubId).eq("wallet_address", wallet);
  if (salt) query = query.eq("salt", salt);
  return query.order("updated_at", { ascending: false }).limit(1).maybeSingle<RobinhoodIntentRow>();
}

async function ownedIntent(githubId: string, wallet: Address, salt: Hex): Promise<RobinhoodIntentRow> {
  const found = await findIntent(githubId, wallet, salt);
  if (found.error) throw new RobinhoodRecoveryError("Robinhood launch recovery is unavailable", 503);
  if (!found.data) throw new RobinhoodRecoveryError("Robinhood launch intent was not found", 404);
  return found.data;
}

export async function getRobinhoodIntent(githubId: string, wallet: Address, salt: Hex) {
  return ownedIntent(githubId, wallet, salt);
}

async function findActiveIntent(githubId: string, wallet: Address) {
  return (await serverClient()).from("robinhood_launch_intents").select("*")
    .eq("github_id", githubId).eq("wallet_address", wallet)
    .in("status", ["prepared", "ambiguous", "submitted"]).maybeSingle<RobinhoodIntentRow>();
}

async function expirePreparedIntents(githubId: string, wallet: Address): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await (await serverClient()).from("robinhood_launch_intents").update({
    status: "failed",
    failure_reason: "Launch recovery intent expired",
    updated_at: now,
  }).eq("github_id", githubId).eq("wallet_address", wallet)
    .eq("status", "prepared").lt("expires_at", now);
  if (error) throw new RobinhoodRecoveryError("Robinhood launch recovery is unavailable", 503);
}

async function insertIntent(githubId: string, intent: NormalizedRobinhoodIntent, preparedBlock: bigint) {
  return (await serverClient()).from("robinhood_launch_intents").insert({
    github_id: githubId,
    wallet_address: intent.walletAddress,
    salt: intent.salt,
    config: intent.config,
    initial_buy_wei: intent.initialBuyWei.toString(),
    prepared_block_number: preparedBlock.toString(),
    last_scanned_block: (preparedBlock - BigInt(1)).toString(),
  }).select("*").single<RobinhoodIntentRow>();
}

export async function prepareRobinhoodIntent(
  githubId: string,
  intent: NormalizedRobinhoodIntent,
): Promise<RobinhoodIntentRow> {
  await expirePreparedIntents(githubId, intent.walletAddress);
  const exact = await findIntent(githubId, intent.walletAddress, intent.salt);
  if (exact.error) throw new RobinhoodRecoveryError("Robinhood launch recovery is unavailable", 503);
  if (exact.data) {
    if (!isSameRobinhoodIntent(exact.data, intent)) throw new RobinhoodRecoveryError("Salt is already reserved", 409);
    return exact.data;
  }
  const active = await findActiveIntent(githubId, intent.walletAddress);
  if (active.error) throw new RobinhoodRecoveryError("Robinhood launch recovery is unavailable", 503);
  if (active.data) throw new RobinhoodRecoveryError("A different Robinhood launch is already active", 409);
  let preparedBlock: bigint;
  try {
    preparedBlock = await publicClient().getBlockNumber();
  } catch {
    throw new RobinhoodRecoveryError("Robinhood RPC preparation is unavailable", 503);
  }
  const inserted = await insertIntent(githubId, intent, preparedBlock);
  if (!inserted.error && inserted.data) return inserted.data;
  if (inserted.error?.code === "23505") {
    const raced = await findIntent(githubId, intent.walletAddress, intent.salt);
    if (raced.data && isSameRobinhoodIntent(raced.data, intent)) return raced.data;
    throw new RobinhoodRecoveryError("A Robinhood launch is already active", 409);
  }
  throw new RobinhoodRecoveryError("Robinhood launch recovery is unavailable", 503);
}

function storedIntent(row: RobinhoodIntentRow): NormalizedRobinhoodIntent {
  let intent: NormalizedRobinhoodIntent;
  try {
    intent = normalizeRobinhoodIntent({ walletAddress: row.wallet_address, salt: row.salt, config: row.config });
  } catch {
    throw new RobinhoodRecoveryError("Stored Robinhood launch intent is invalid", 503);
  }
  if (intent.initialBuyWei.toString() !== row.initial_buy_wei) {
    throw new RobinhoodRecoveryError("Stored Robinhood launch amount is inconsistent", 503);
  }
  return intent;
}

export async function markRobinhoodIntentAmbiguous(
  githubId: string,
  wallet: Address,
  salt: Hex,
): Promise<RobinhoodIntentRow> {
  const row = await ownedIntent(githubId, wallet, salt);
  if (row.status === "ambiguous") return row;
  if (row.status !== "prepared") throw new RobinhoodRecoveryError("Ambiguous checkpoint is out of order", 409);
  const { data, error } = await (await serverClient()).from("robinhood_launch_intents").update({
    status: "ambiguous",
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).eq("status", "prepared").is("transaction_hash", null)
    .select("*").maybeSingle<RobinhoodIntentRow>();
  if (!error && !data) return ownedIntent(githubId, wallet, salt);
  if (error || !data) throw new RobinhoodRecoveryError("Robinhood launch recovery is unavailable", 503);
  return data;
}

export async function checkpointRobinhoodIntent(
  githubId: string,
  wallet: Address,
  salt: Hex,
  transactionHash: Hash,
): Promise<RobinhoodIntentRow> {
  const row = await ownedIntent(githubId, wallet, salt);
  if (row.transaction_hash) {
    if (row.transaction_hash !== transactionHash) throw new RobinhoodRecoveryError("Transaction hash cannot be replaced", 409);
    return row;
  }
  if (!["prepared", "ambiguous"].includes(row.status)) {
    throw new RobinhoodRecoveryError("Launch checkpoint is out of order", 409);
  }
  let checkpointState;
  try {
    checkpointState = await prevalidateCheckpointTransaction(publicClient(), transactionHash, storedIntent(row));
  } catch (error) {
    if (error instanceof BaseError) throw new RobinhoodRecoveryError("Robinhood RPC checkpoint is unavailable", 503);
    throw error;
  }
  if (checkpointState === "missing") {
    throw new RobinhoodRetryableError("Transaction is not indexed yet; retry without replacing it", 425);
  }
  if (checkpointState === "mismatch") throw new RobinhoodRecoveryError("Transaction does not match launch intent", 422);
  const { data, error } = await (await serverClient()).from("robinhood_launch_intents").update({
    transaction_hash: transactionHash,
    status: "submitted",
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).in("status", ["prepared", "ambiguous"]).is("transaction_hash", null)
    .select("*").maybeSingle<RobinhoodIntentRow>();
  if (!error && !data) {
    const raced = await ownedIntent(githubId, wallet, salt);
    if (raced.transaction_hash === transactionHash) return raced;
    throw new RobinhoodRecoveryError("Transaction hash cannot be replaced", 409);
  }
  if (error || !data) throw new RobinhoodRecoveryError("Robinhood launch recovery is unavailable", 503);
  return data;
}

export async function latestRobinhoodIntent(githubId: string, wallet: Address) {
  const result = await findIntent(githubId, wallet);
  if (result.error) throw new RobinhoodRecoveryError("Robinhood launch recovery is unavailable", 503);
  return result.data;
}

async function updateActive(row: RobinhoodIntentRow, values: Record<string, unknown>) {
  const { data, error } = await (await serverClient()).from("robinhood_launch_intents").update({
    ...values,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).in("status", ["ambiguous", "submitted"])
    .select("*").maybeSingle<RobinhoodIntentRow>();
  if (error || !data) throw new RobinhoodRecoveryError("Robinhood launch recovery is unavailable", 503);
  return data;
}

async function bindServerCandidate(row: RobinhoodIntentRow, candidate: LaunchCandidate) {
  if (row.transaction_hash === candidate.hash && row.status === "submitted") return row;
  return updateActive(row, { transaction_hash: candidate.hash.toLowerCase(), status: "submitted" });
}

async function markFailed(row: RobinhoodIntentRow, reason: string) {
  return updateActive(row, { status: "failed", failure_reason: reason.slice(0, 500) });
}

async function markVerified(row: RobinhoodIntentRow, token: Address, pool: Address, positionId: bigint) {
  return updateActive(row, {
    status: "verified",
    token_address: token.toLowerCase(),
    pool_address: pool.toLowerCase(),
    position_id: positionId.toString(),
  });
}

async function verifyCandidate(row: RobinhoodIntentRow, intent: NormalizedRobinhoodIntent, candidate: LaunchCandidate) {
  const bound = await bindServerCandidate(row, candidate);
  const latestBlock = await publicClient().getBlockNumber();
  if (!hasRequiredConfirmations(latestBlock, candidate.receipt.blockNumber)) return bound;
  try {
    const decoded = decodePonsLaunchReceipt(candidate.receipt.logs);
    const verified = await verifyPonsLaunchReceipt(publicClient(), decoded, {
      deployer: intent.walletAddress,
      feeWallet: intent.config.feeWallet as Address,
      initialBuyWei: intent.initialBuyWei,
    });
    return markVerified(bound, verified.token, verified.pool, verified.positionId);
  } catch (error) {
    if (error instanceof BaseError) throw new RobinhoodRecoveryError("Robinhood RPC reconciliation is unavailable", 503);
    return markFailed(bound, error instanceof Error ? error.message : "Launch verification failed");
  }
}

export async function reconcileRobinhoodIntent(row: RobinhoodIntentRow): Promise<RobinhoodIntentRow> {
  if (!["submitted", "ambiguous"].includes(row.status)) return row;
  const client = publicClient();
  const intent = storedIntent(row);
  try {
    const latestBlock = await client.getBlockNumber();
    const known = row.transaction_hash
      ? await inspectKnownTransaction(client, row.transaction_hash as Hash, intent)
      : null;
    if (known?.state === "success" && known.receipt) {
      return verifyCandidate(row, intent, { hash: known.hash, receipt: known.receipt });
    }
    const scan = await scanForExactLaunch(
      client,
      intent,
      BigInt(row.prepared_block_number),
      BigInt(row.last_scanned_block),
      latestBlock,
    );
    if (scan.candidate) return verifyCandidate(row, intent, scan.candidate);
    const scanned = scan.scannedThrough > BigInt(row.last_scanned_block)
      ? await updateActive(row, { last_scanned_block: scan.scannedThrough.toString() })
      : row;
    if (known && shouldFailAfterReplacementScan(known.state, scan.isComplete, false)) {
      return markFailed(scanned, `Submitted transaction ${known.state}`);
    }
    return scanned;
  } catch (error) {
    if (error instanceof RobinhoodRecoveryError) throw error;
    if (error instanceof BaseError) throw new RobinhoodRecoveryError("Robinhood RPC reconciliation is unavailable", 503);
    throw new RobinhoodRecoveryError("Robinhood reconciliation is unavailable", 503);
  }
}
