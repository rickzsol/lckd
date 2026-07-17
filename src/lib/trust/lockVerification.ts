import { Connection } from "@solana/web3.js";
import {
  ICluster,
  SolanaStreamClient,
} from "@streamflow/stream";
import BN from "bn.js";
import type { LockStatus } from "@/types/trust";

/**
 * Finalized withdrawal verification, shared by the webhook consumer and the
 * reconciliation sweep. The webhook is a trigger only; the chain is the truth.
 * Withdrawal state is a `withdrawnAmount` comparison, never a schedule read:
 * the SDK's `unlocked(ts)` reports fully-unlocked at the cliff even if nothing
 * moved. We compare finalized on-chain `withdrawnAmount` against the stored
 * value and derive status from deposited/withdrawn, then let wall-clock
 * eligibility fill in `locked -> unlock_eligible`.
 */
export interface StreamState {
  depositedAmount: bigint;
  withdrawnAmount: bigint;
  closed: boolean;
}

export interface LockVerificationResult {
  /** New withdrawn amount as a decimal string for the numeric column. */
  withdrawnAmount: string;
  /** Derived status from on-chain amounts + wall-clock cliff. */
  status: LockStatus;
}

function inferCluster(rpcEndpoint: string): ICluster {
  const endpoint = rpcEndpoint.toLowerCase();
  if (endpoint.includes("devnet")) return ICluster.Devnet;
  if (endpoint.includes("testnet")) return ICluster.Testnet;
  if (endpoint.includes("localhost") || endpoint.includes("127.0.0.1")) {
    return ICluster.Local;
  }
  return ICluster.Mainnet;
}

/**
 * Reads a stream at finalized commitment. Returns null when the account is gone
 * (closed after full withdrawal) so the caller can mark it withdrawn.
 */
export async function readFinalizedStreamState(
  connection: Connection,
  streamId: string,
): Promise<StreamState | null> {
  const client = new SolanaStreamClient({
    clusterUrl: connection.rpcEndpoint,
    cluster: inferCluster(connection.rpcEndpoint),
    commitment: "finalized",
  });

  try {
    const stream = await client.getOne({ id: streamId });
    return {
      depositedAmount: toBigInt(stream.depositedAmount),
      withdrawnAmount: toBigInt(stream.withdrawnAmount),
      closed: stream.closed === true,
    };
  } catch (error) {
    if (isAccountNotFound(error)) return null;
    throw error;
  }
}

function toBigInt(value: BN): bigint {
  return BigInt(value.toString());
}

function isAccountNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("not found") || message.includes("could not find") || message.includes("account does not exist");
}

/**
 * Pure derivation from stored + finalized on-chain state. Partial withdrawals
 * update the amount and keep `unlock_eligible`; full withdrawal (or a closed
 * escrow) transitions to `withdrawn`. A drop in withdrawn amount vs stored, or
 * withdrawn exceeding deposited, is `anomalous` (never silently corrected).
 */
export function deriveWithdrawalStatus(
  storedWithdrawn: bigint,
  onchain: StreamState | null,
  cliffTs: string,
  now: number,
): LockVerificationResult {
  // Escrow account gone => fully withdrawn and closed.
  if (onchain === null) {
    return { withdrawnAmount: storedWithdrawn.toString(), status: "withdrawn" };
  }

  const { depositedAmount, withdrawnAmount, closed } = onchain;

  if (withdrawnAmount > depositedAmount || withdrawnAmount < storedWithdrawn) {
    return { withdrawnAmount: withdrawnAmount.toString(), status: "anomalous" };
  }

  if (closed || (depositedAmount > BigInt(0) && withdrawnAmount >= depositedAmount)) {
    return { withdrawnAmount: withdrawnAmount.toString(), status: "withdrawn" };
  }

  const cliffMs = new Date(cliffTs).getTime();
  if (!Number.isFinite(cliffMs)) {
    return { withdrawnAmount: withdrawnAmount.toString(), status: "anomalous" };
  }

  const timeEligible = now >= cliffMs;
  if (withdrawnAmount > BigInt(0)) {
    // Partial withdrawal observed: eligible until fully drained.
    return { withdrawnAmount: withdrawnAmount.toString(), status: "unlock_eligible" };
  }
  return {
    withdrawnAmount: withdrawnAmount.toString(),
    status: timeEligible ? "unlock_eligible" : "locked",
  };
}
