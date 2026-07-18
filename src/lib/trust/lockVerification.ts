import { Connection, PublicKey } from "@solana/web3.js";
import {
  ICluster,
  SolanaStreamClient,
  StreamType,
} from "@streamflow/stream";
import BN from "bn.js";
import type { LockStatus } from "@/types/trust";

/**
 * Finalized lock verification, shared by the webhook consumer and the
 * reconciliation sweep. The webhook is a trigger only; the chain is the truth.
 *
 * Two distinct concerns, kept separate on purpose:
 *  1. Reading finalized state (`readFinalizedStreamState`) returns a discriminated
 *     outcome so the caller can tell a CONFIRMED closure (account provably gone
 *     under the pinned program) from a TYPED RPC/lookup FAILURE. Absence alone is
 *     never treated as a withdrawal (finding 2).
 *  2. Binding the decoded stream to the stored lock identity + cliff-only schedule
 *     (`bindStreamToLock`), so a wrong stream id / mint / recipient / program can
 *     never be accepted as evidence for a lock it does not lock (finding 3).
 *
 * Withdrawal state is a `withdrawnAmount` comparison, never a schedule read: the
 * SDK's `unlocked(ts)` reports fully-unlocked at the cliff even if nothing moved.
 */

/** Identity + schedule fields of a stored lock, used to bind finalized state. */
export interface LockIdentity {
  streamProgram: string;
  mint: string;
  recipient: string;
  escrowAta: string;
  depositedAmount: string;
  cliffTsRaw: string;
}

/** Decoded finalized stream, with the identity fields needed for binding. */
export interface DecodedStream {
  streamProgram: string;
  mint: string;
  sender: string;
  recipient: string;
  escrowTokens: string;
  depositedAmount: bigint;
  withdrawnAmount: bigint;
  cliff: number;
  cliffAmount: bigint;
  start: number;
  end: number;
  period: number;
  amountPerPeriod: bigint;
  isLock: boolean;
  closed: boolean;
}

/**
 * Discriminated read outcome. Withdrawal evidence lives ONLY in the `ok` stream
 * (an existing account whose withdrawnAmount reached the deposit, or a decoded
 * closed flag observed at/after the cliff). A bare absent account is `not_found`,
 * never a withdrawal (finding 2): a wrong stream id, wrong cluster, or an
 * unindexed account all read as null, and absence alone is not proof the deposit
 * left the escrow. `rpc_error` likewise never implies a withdrawal.
 */
export type StreamReadResult =
  | { kind: "ok"; stream: DecodedStream }
  | { kind: "not_found" } // account absent: not proof of withdrawal
  | { kind: "rpc_error"; message: string };

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

function toBigInt(value: BN | bigint | number): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  return BigInt(value.toString());
}

function isAccountNotFound(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message.toLowerCase()
    : String(error).toLowerCase();
  return (
    message.includes("not found") ||
    message.includes("could not find") ||
    message.includes("account does not exist")
  );
}

/**
 * Reads a stream at finalized commitment and returns a discriminated outcome.
 * The account owner is read first from raw finalized state: a null account is an
 * unconfirmed absence (`not_found`), never a withdrawal (finding 2), and any RPC
 * throw is `rpc_error`, never silently mapped to a withdrawal. Withdrawal is
 * derived only from a decoded stream's amounts/closed flag.
 */
export async function readFinalizedStreamState(
  connection: Connection,
  streamId: string,
): Promise<StreamReadResult> {
  const client = new SolanaStreamClient({
    clusterUrl: connection.rpcEndpoint,
    cluster: inferCluster(connection.rpcEndpoint),
    commitment: "finalized",
  });

  // Read the ACTUAL account owner from finalized state instead of assuming the
  // decoder's pinned program (finding 3). getOne would happily decode bytes even
  // if the account were owned by an impostor program; the on-chain owner is the
  // ground truth we carry into binding so a spoofed account under a different
  // program can never pass the streamProgram check.
  let ownerProgram: string;
  try {
    const info = await connection.getAccountInfo(new PublicKey(streamId), "finalized");
    if (info === null) {
      // Absent account: not proof of anything. Never a confirmed withdrawal
      // (finding 2); surfaced as an unconfirmed absence so the caller aborts.
      return { kind: "not_found" };
    }
    ownerProgram = info.owner.toBase58();
  } catch (error) {
    return {
      kind: "rpc_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  let stream: Awaited<ReturnType<SolanaStreamClient["getOne"]>>;
  try {
    stream = await client.getOne({ id: streamId });
  } catch (error) {
    if (isAccountNotFound(error)) {
      // The owner read above already saw a live account, so a getOne decode miss
      // here is an RPC hiccup or an undecodable (foreign-program) account, not a
      // confirmed closure. Never map it to a withdrawal (finding 2).
      return {
        kind: "rpc_error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      kind: "rpc_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    kind: "ok",
    stream: {
      // The account's on-chain owner, read above from finalized state. Binding
      // compares this against the stored (pinned) program (finding 3).
      streamProgram: ownerProgram,
      mint: stream.mint,
      sender: stream.sender,
      recipient: stream.recipient,
      escrowTokens: stream.escrowTokens,
      depositedAmount: toBigInt(stream.depositedAmount),
      withdrawnAmount: toBigInt(stream.withdrawnAmount),
      cliff: stream.cliff,
      cliffAmount: toBigInt(stream.cliffAmount),
      start: stream.start,
      end: stream.end,
      period: stream.period,
      amountPerPeriod: toBigInt(stream.amountPerPeriod),
      isLock: stream.type === StreamType.Lock,
      closed: stream.closed === true,
    },
  };
}

/**
 * Binds a decoded finalized stream to the stored lock identity + cliff-only
 * schedule. Returns null when everything matches, or a human-readable mismatch
 * reason. A stream that does not lock the stored mint for the stored recipient,
 * under the pinned program, at the stored cliff releasing the full deposit, is
 * NOT valid evidence for this lock (finding 3).
 */
export function bindStreamToLock(
  stream: DecodedStream,
  identity: LockIdentity,
): string | null {
  if (!stream.isLock) return "stream is not a token lock";
  if (stream.streamProgram !== identity.streamProgram) {
    return "stream program mismatch";
  }
  if (stream.mint !== identity.mint) return "mint mismatch";
  // A cliff lock created by this app has sender === recipient. The stored
  // recipient is the wallet; require the decoded recipient to match it.
  if (stream.recipient !== identity.recipient) return "recipient mismatch";
  if (identity.escrowAta && stream.escrowTokens !== identity.escrowAta) {
    return "escrow account mismatch";
  }
  if (stream.depositedAmount !== BigInt(identity.depositedAmount)) {
    return "deposited amount mismatch";
  }
  if (String(stream.cliff) !== String(identity.cliffTsRaw)) {
    return "cliff timestamp mismatch";
  }
  // Canonical full-cliff schedule per the Streamflow SDK. Nothing is unlockable
  // before the cliff (calculateUnlockedAmount returns 0 while now < cliff), which
  // start === cliff guarantees. The SDK's own isCliffCloseToDepositedAmount treats
  // cliffAmount >= depositedAmount - 1 as a full cliff, and buildLockParams emits a
  // one-unit residual tail (amountPerPeriod 1, period 1) rather than an exact
  // cliffAmount === depositedAmount. Requiring strict equality wrongly rejects the
  // documented pattern, so accept the SDK's range instead (finding 3-new).
  if (stream.start !== stream.cliff) return "start does not equal cliff";
  // end MUST be at or after the cliff. An inverted/degenerate schedule (end <
  // cliff) makes (end - cliff) negative, which would slip past the <= 1s tail
  // bound below and wrongly accept a schedule that is not a full cliff. Reject it
  // explicitly before the tail check (finding: inverted-schedule).
  if (stream.end < stream.cliff) return "inverted schedule (end before cliff)";
  if (stream.end - stream.cliff > MAX_CLIFF_END_GAP_SECONDS) {
    return "schedule has a post-cliff tail";
  }
  if (!isFullCliff(stream.cliffAmount, stream.depositedAmount)) {
    return "cliff does not release the full deposit";
  }
  return null;
}

/** The Streamflow SDK's MAX_CLIFF_END_GAP_SECONDS: a full-cliff lock unlocks the
 * residual within one second of the cliff. Mirrored here so the bind check tracks
 * the same tolerance the SDK's isTokenLock uses. */
export const MAX_CLIFF_END_GAP_SECONDS = 1;

/**
 * Full-cliff acceptance mirroring the SDK's isCliffCloseToDepositedAmount:
 * cliffAmount within [depositedAmount - 1, depositedAmount]. The canonical lock
 * releases the whole deposit at the cliff except for at most a one-unit residual
 * that unlocks in the same one-second window, so strict equality is wrong
 * (finding 3-new). cliffAmount above the deposit is impossible on-chain and
 * treated as not-a-full-cliff.
 */
export function isFullCliff(cliffAmount: bigint, depositedAmount: bigint): boolean {
  if (cliffAmount > depositedAmount) return false;
  return cliffAmount >= depositedAmount - BigInt(1);
}

/**
 * Pure derivation from stored + finalized on-chain state, over a bound stream.
 *
 * Withdrawal is PROVEN only from positive evidence on an existing stream account:
 * withdrawnAmount reaching the deposit, or the decoded `closed` flag, both AT/AFTER
 * the cliff (finding 2). A bare absent account never reaches here as a withdrawal:
 * `not_found` and `rpc_error` throw so the caller aborts without inventing one.
 *
 * Pre-cliff movement is an EARLY BREACH of a cliff lock and is `anomalous`, never
 * `unlock_eligible`/`withdrawn` (finding 4):
 *  - any withdrawal observed before the cliff is anomalous,
 *  - a closed/fully-withdrawn escrow before the cliff is anomalous.
 * withdrawn exceeding deposited, or dropping below stored, is also `anomalous`.
 */
export function deriveWithdrawalStatus(
  storedWithdrawn: bigint,
  read: StreamReadResult,
  cliffTs: string,
  now: number,
): LockVerificationResult {
  const cliffMs = new Date(cliffTs).getTime();
  const cliffKnown = Number.isFinite(cliffMs);
  const beforeCliff = cliffKnown && now < cliffMs;

  if (read.kind === "rpc_error" || read.kind === "not_found") {
    // Never invent a withdrawal from a read failure or an unconfirmed absence.
    // An absent account is not proof the deposit ever left the escrow: a wrong
    // stream id or wrong cluster reads null too (finding 2).
    throw new StreamUnavailableError(
      read.kind === "rpc_error"
        ? read.message
        : "stream account absent: no positive withdrawal evidence",
    );
  }

  const { depositedAmount, withdrawnAmount, closed } = read.stream;

  if (withdrawnAmount > depositedAmount || withdrawnAmount < storedWithdrawn) {
    return { withdrawnAmount: withdrawnAmount.toString(), status: "anomalous" };
  }

  if (!cliffKnown) {
    return { withdrawnAmount: withdrawnAmount.toString(), status: "anomalous" };
  }

  // Any movement before the cliff breaches a cliff lock.
  if (beforeCliff && (withdrawnAmount > BigInt(0) || closed)) {
    return { withdrawnAmount: withdrawnAmount.toString(), status: "anomalous" };
  }

  if (closed || (depositedAmount > BigInt(0) && withdrawnAmount >= depositedAmount)) {
    return { withdrawnAmount: withdrawnAmount.toString(), status: "withdrawn" };
  }

  const timeEligible = now >= cliffMs;
  if (withdrawnAmount > BigInt(0)) {
    // Partial withdrawal at/after the cliff: eligible until fully drained.
    return { withdrawnAmount: withdrawnAmount.toString(), status: "unlock_eligible" };
  }
  return {
    withdrawnAmount: withdrawnAmount.toString(),
    status: timeEligible ? "unlock_eligible" : "locked",
  };
}

/** Thrown when finalized stream state cannot be established (RPC failure or an
 * unconfirmed absence). The caller must NOT mutate lock state on this. */
export class StreamUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamUnavailableError";
  }
}
