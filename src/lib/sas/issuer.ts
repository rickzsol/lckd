import "server-only";

import {
  deriveAttestationPda,
  deriveEventAuthorityAddress,
  fetchMaybeAttestation,
  getCreateAttestationInstruction,
  getCloseAttestationInstruction,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
} from "sas-lib";
import {
  address,
  createTransaction,
  getSignatureFromTransaction,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type SolanaClient,
} from "gill";

import {
  createSasClient,
  loadFeePayerSigner,
  loadSasConfig,
  loadSignerSigner,
  type SasConfig,
} from "./config";
import {
  evidenceToAttestationData,
  hashEvidence,
  type TrustEvidence,
} from "./evidence";
import {
  deserializeTrustData,
  serializeTrustData,
  type TrustAttestationData,
} from "./schema";

const CONFIRM_COMMITMENT = "finalized" as const;

export class SasIssuerError extends Error {
  constructor(message: string, readonly retryable: boolean = true) {
    super(message);
  }
}

/**
 * The complete live on-chain state for a mint's attestation: the full decoded
 * payload plus the account's outer expiry. Every evidence-bearing field is here
 * so the idempotency decision compares the WHOLE claim, not a subset.
 */
export interface LivePayload {
  data: TrustAttestationData;
  expiry: bigint;
}

export type IssuanceDecision = "skip" | "issue" | "reissue";

/**
 * Pure idempotency decision. Given the live on-chain state (or null when no
 * attestation exists) and the desired evidence, decide whether to skip, issue
 * fresh, or close-and-reissue.
 *
 * The comparison is the FULL evidence hash of the live payload versus the desired
 * evidence, plus the outer expiry (which is not part of the payload but must
 * still match the desired cliff). Any drift in creator, stream_id, github, tier,
 * lock_bps, cliff, policy, or expiry is a reissue; an exact match is a skip;
 * absence is a fresh issue. No RPC, no side effects: unit-tested issuance safety.
 */
export function decideIssuance(
  live: LivePayload | null,
  desired: TrustEvidence,
): IssuanceDecision {
  if (!live) return "issue";
  const liveEvidence: TrustEvidence = {
    mint: live.data.mint,
    creator: live.data.creator,
    streamId: live.data.stream_id,
    tier: live.data.tier as TrustEvidence["tier"],
    lockBps: live.data.lock_bps,
    cliffTs: live.data.cliff_ts,
    github: live.data.github,
    policyVersion: live.data.policy_version,
    // schema_version is not stored in the on-chain payload (it is pinned by the
    // schema PDA at verify time), so mirror the desired value to avoid a
    // spurious mismatch on a field the chain cannot carry.
    schemaVersion: desired.schemaVersion,
  };
  const sameClaim = hashEvidence(liveEvidence) === hashEvidence(desired);
  const sameExpiry = live.expiry === desired.cliffTs;
  return sameClaim && sameExpiry ? "skip" : "reissue";
}

export interface AttestationContext {
  client: SolanaClient;
  config: SasConfig;
  signer: KeyPairSigner;
  feePayer: KeyPairSigner;
}

/** Build the RPC client, pinned config, and hot signers for issuance work. */
export async function buildAttestationContext(): Promise<AttestationContext> {
  const config = loadSasConfig();
  const [signer, feePayer] = await Promise.all([
    loadSignerSigner(),
    loadFeePayerSigner(),
  ]);
  return {
    client: createSasClient(config.cluster),
    config,
    signer,
    feePayer,
  };
}

export async function deriveTrustAttestationPda(
  config: SasConfig,
  mint: string,
): Promise<Address> {
  const [pda] = await deriveAttestationPda({
    credential: config.credentialPda,
    schema: config.schemaPda,
    nonce: address(mint),
  });
  return pda;
}

/** Read the live on-chain payload + expiry for a mint, or null if no attestation. */
export async function readLivePayload(
  ctx: AttestationContext,
  mint: string,
): Promise<LivePayload | null> {
  const pda = await deriveTrustAttestationPda(ctx.config, mint);
  const account = await fetchMaybeAttestation(ctx.client.rpc, pda);
  if (!account.exists) return null;
  const data = deserializeTrustData(account.data.data as Uint8Array);
  return { data, expiry: account.data.expiry };
}

/** Whether a live attestation account currently exists for the mint. */
export async function attestationExists(
  ctx: AttestationContext,
  mint: string,
): Promise<boolean> {
  const pda = await deriveTrustAttestationPda(ctx.config, mint);
  const account = await fetchMaybeAttestation(ctx.client.rpc, pda);
  return account.exists;
}

type SignedTransaction = Awaited<ReturnType<typeof signTransactionMessageWithSigners>>;

interface PreparedTransaction {
  signature: string;
  signed: SignedTransaction;
}

/**
 * Build, simulate, and sign a transaction WITHOUT broadcasting. Returning the
 * signature before broadcast lets the outbox persist it first, so an ambiguous
 * broadcast (timeout after the tx may have landed) can be reconciled from chain.
 */
async function prepareTransaction(
  ctx: AttestationContext,
  instructions: Instruction[],
): Promise<PreparedTransaction> {
  const { value: latestBlockhash } = await ctx.client.rpc.getLatestBlockhash().send();
  const message = createTransaction({
    version: "legacy",
    feePayer: ctx.feePayer,
    instructions,
    latestBlockhash,
    computeUnitLimit: 200_000,
    computeUnitPrice: 100_000,
  });

  const simulation = await ctx.client.simulateTransaction(message);
  if (simulation.value.err) {
    throw new SasIssuerError(
      `Attestation simulation failed: ${JSON.stringify(simulation.value.err)}`,
      false,
    );
  }

  const signed = await signTransactionMessageWithSigners(message);
  return { signature: getSignatureFromTransaction(signed), signed };
}

async function simulateThenSend(
  ctx: AttestationContext,
  instructions: Instruction[],
): Promise<string> {
  const { signature, signed } = await prepareTransaction(ctx, instructions);
  await ctx.client.sendAndConfirmTransaction(signed, {
    commitment: CONFIRM_COMMITMENT,
  });
  return signature;
}

export interface IssueResult {
  signature: string;
  attestationPda: string;
}

/** Build the create-attestation instruction for server-derived evidence. */
export async function buildCreateInstruction(
  ctx: AttestationContext,
  evidence: TrustEvidence,
): Promise<{ instruction: Instruction; attestationPda: Address }> {
  const mintAddress = address(evidence.mint);
  const attestationPda = await deriveTrustAttestationPda(ctx.config, evidence.mint);
  const data = serializeTrustData(evidenceToAttestationData(evidence));
  const instruction = getCreateAttestationInstruction({
    payer: ctx.feePayer,
    authority: ctx.signer,
    credential: ctx.config.credentialPda,
    schema: ctx.config.schemaPda,
    attestation: attestationPda,
    nonce: mintAddress,
    expiry: evidence.cliffTs,
    data,
  });
  return { instruction, attestationPda };
}

/** Build the close-attestation instruction for a mint. */
export async function buildCloseInstruction(
  ctx: AttestationContext,
  mint: string,
): Promise<{ instruction: Instruction; attestationPda: Address }> {
  const attestationPda = await deriveTrustAttestationPda(ctx.config, mint);
  const eventAuthority = await deriveEventAuthorityAddress();
  const instruction = getCloseAttestationInstruction({
    payer: ctx.feePayer,
    attestation: attestationPda,
    authority: ctx.signer,
    credential: ctx.config.credentialPda,
    eventAuthority,
    attestationProgram: SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
  });
  return { instruction, attestationPda };
}

/**
 * Prepare (build + simulate + sign) a transaction without broadcasting, so the
 * signature can be persisted first. Broadcast it later with broadcastPrepared.
 */
export function prepareInstructions(
  ctx: AttestationContext,
  instructions: Instruction[],
): Promise<{ signature: string; signed: SignedTransaction }> {
  return prepareTransaction(ctx, instructions);
}

/** Broadcast a previously-prepared signed transaction and confirm finalized. */
export async function broadcastPrepared(
  ctx: AttestationContext,
  signed: SignedTransaction,
): Promise<void> {
  await ctx.client.sendAndConfirmTransaction(signed, { commitment: CONFIRM_COMMITMENT });
}

/**
 * Create a fresh attestation for the mint from server-derived evidence. Expiry
 * is set to the lock cliff so the attestation dies exactly when the lock does.
 * Simulates before send; confirms at finalized commitment.
 */
export async function createAttestation(
  ctx: AttestationContext,
  evidence: TrustEvidence,
): Promise<IssueResult> {
  const { instruction, attestationPda } = await buildCreateInstruction(ctx, evidence);
  const signature = await simulateThenSend(ctx, [instruction]);
  return { signature, attestationPda: attestationPda.toString() };
}

/**
 * Close an existing attestation (reclaims rent). Used for revocation and as the
 * first half of a reissue. Simulates before send; confirms at finalized.
 */
export async function closeAttestation(
  ctx: AttestationContext,
  mint: string,
): Promise<IssueResult> {
  const { instruction, attestationPda } = await buildCloseInstruction(ctx, mint);
  const signature = await simulateThenSend(ctx, [instruction]);
  return { signature, attestationPda: attestationPda.toString() };
}

export type SignatureState = "finalized" | "confirmed" | "failed" | "unknown";

/**
 * Reconcile a persisted signature from chain. Used when a broadcast outcome is
 * ambiguous (the worker crashed or timed out after persisting the signature but
 * before confirming): the chain is the truth. Returns finalized/confirmed once
 * the tx has landed (a confirmed tx WILL finalize barring a rollback of an
 * already-confirmed block, which SAS treats as landed), failed on an on-chain
 * error, unknown only if the tx never landed at all.
 */
export async function reconcileSignature(
  ctx: AttestationContext,
  signature: string,
): Promise<SignatureState> {
  const { value } = await ctx.client.rpc
    .getSignatureStatuses([signature as never], { searchTransactionHistory: true })
    .send();
  const status = value[0];
  if (!status) return "unknown";
  if (status.err) return "failed";
  if (status.confirmationStatus === "finalized") return "finalized";
  if (status.confirmationStatus === "confirmed") return "confirmed";
  return "unknown";
}

export type IssuanceOutcome =
  | { decision: "skip"; attestationPda: string }
  | { decision: "issue"; attestationPda: string; signature: string }
  | { decision: "reissue"; attestationPda: string; closeSignature: string | null; signature: string };

/**
 * Idempotent issuance: read the live payload, decide, and act. Skips when the
 * live PDA already matches the desired payload. The DB active-attestation unique
 * index prevents concurrent double-issuance; this is the on-chain half.
 *
 * Note: this issues close and create as two finalized transactions rather than
 * one atomic effect. Callers must drive it through the outbox so an ambiguous
 * outcome (close landed, create pending) reconciles from chain by signature.
 */
export async function issueOrReissue(
  ctx: AttestationContext,
  evidence: TrustEvidence,
): Promise<IssuanceOutcome> {
  const live = await readLivePayload(ctx, evidence.mint);
  const decision = decideIssuance(live, evidence);

  if (decision === "skip") {
    const pda = await deriveTrustAttestationPda(ctx.config, evidence.mint);
    return { decision: "skip", attestationPda: pda.toString() };
  }

  if (decision === "reissue") {
    // The close half is a no-op if the account was already closed externally, so
    // only close when it actually exists. Otherwise a reissue after an external
    // close would simulation-fail on the missing account.
    const stillExists = await attestationExists(ctx, evidence.mint);
    const closeSignature = stillExists
      ? (await closeAttestation(ctx, evidence.mint)).signature
      : null;
    const created = await createAttestation(ctx, evidence);
    return {
      decision: "reissue",
      attestationPda: created.attestationPda,
      closeSignature,
      signature: created.signature,
    };
  }

  const created = await createAttestation(ctx, evidence);
  return { decision: "issue", attestationPda: created.attestationPda, signature: created.signature };
}
