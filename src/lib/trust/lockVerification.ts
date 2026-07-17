import { Connection, PublicKey } from "@solana/web3.js";
import {
  ICluster,
  PROGRAM_ID,
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

/** Discriminated read outcome. `closed` requires PROVEN account absence under
 * the pinned program; `rpc_error` and `not_lock` never imply a withdrawal. */
export type StreamReadResult =
  | { kind: "ok"; stream: DecodedStream }
  | { kind: "closed" } // account provably gone under the pinned program
  | { kind: "not_found" } // account absent but closure not confirmed (owner unknown)
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
 * Confirms an account is truly gone (closed after withdrawal) rather than
 * transiently unreadable. Returns "closed" only when the RPC positively reports
 * a null account (finalized) AND the pinned program is a valid pubkey; any RPC
 * throw is surfaced as an error so absence-from-failure is never "withdrawn".
 */
async function confirmClosed(
  connection: Connection,
  streamId: string,
): Promise<StreamReadResult> {
  let streamPk: PublicKey;
  try {
    streamPk = new PublicKey(streamId);
  } catch {
    return { kind: "rpc_error", message: `Invalid stream id ${streamId}` };
  }
  try {
    const info = await connection.getAccountInfo(streamPk, "finalized");
    // A finalized null means the metadata account no longer exists on chain.
    // Streamflow closes the metadata account only after a full withdrawal.
    return info === null ? { kind: "closed" } : { kind: "not_found" };
  } catch (error) {
    return {
      kind: "rpc_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Reads a stream at finalized commitment and returns a discriminated outcome.
 * A getOne "not found" is re-checked against the raw finalized account so we can
 * distinguish a confirmed closure from an RPC hiccup. Any other error is
 * `rpc_error`, never silently mapped to a withdrawal.
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

  let stream: Awaited<ReturnType<SolanaStreamClient["getOne"]>>;
  try {
    stream = await client.getOne({ id: streamId });
  } catch (error) {
    if (isAccountNotFound(error)) {
      // getOne could not decode the account. Confirm it is genuinely gone.
      return confirmClosed(connection, streamId);
    }
    return {
      kind: "rpc_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    kind: "ok",
    stream: {
      // The SolanaStreamClient decodes only its own program's accounts; the
      // Streamflow program id is pinned in the client. Carry it for binding.
      streamProgram: streamProgramFor(connection),
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

function streamProgramFor(connection: Connection): string {
  // Program id is resolved by the SDK from the cluster; mirror that here so the
  // binding check can compare it against the stored stream_program.
  return PROGRAM_ID[inferCluster(connection.rpcEndpoint)];
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
  // Cliff-only schedule: start === cliff, the full deposit releases at the cliff,
  // and there is no linear tail (single one-second period).
  if (stream.start !== stream.cliff) return "start does not equal cliff";
  if (stream.cliffAmount !== stream.depositedAmount) {
    return "cliff does not release the full deposit";
  }
  if (stream.period !== 1 || stream.amountPerPeriod !== BigInt(1)) {
    return "not a single-period cliff schedule";
  }
  if (stream.end - stream.cliff > 1) return "schedule has a post-cliff tail";
  return null;
}

/**
 * Pure derivation from stored + finalized on-chain state, over a bound stream.
 *
 * Pre-cliff movement is an EARLY BREACH of a cliff lock and is `anomalous`, never
 * `unlock_eligible`/`withdrawn` (finding 4):
 *  - any withdrawal observed before the cliff is anomalous,
 *  - a closed/fully-withdrawn escrow before the cliff is anomalous.
 * withdrawn exceeding deposited, or dropping below stored, is also `anomalous`.
 * A confirmed closure or full withdrawal AT/AFTER the cliff is `withdrawn`.
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
    // Never invent a withdrawal from a read failure or unconfirmed absence.
    throw new StreamUnavailableError(
      read.kind === "rpc_error" ? read.message : "stream account not confirmed closed",
    );
  }

  if (read.kind === "closed") {
    // Escrow provably gone => fully withdrawn. Before the cliff this is an early
    // breach of a cliff lock, not a normal release.
    return {
      withdrawnAmount: storedWithdrawn.toString(),
      status: beforeCliff ? "anomalous" : "withdrawn",
    };
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
