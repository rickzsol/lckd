import type { TrustTier } from "./index";

/** Time-eligibility vs proven-release lock lifecycle. A passed cliff is only
 * "withdrawn" once a finalized withdrawal is observed. */
export type LockStatus = "locked" | "unlock_eligible" | "withdrawn" | "anomalous";

/** Row shape from the `locks_public` view (anon-safe subset). */
export interface LockPublicRow {
  id: string;
  token_id: string;
  mint: string;
  stream_program: string;
  stream_id: string;
  recipient: string;
  deposited_amount: string;
  withdrawn_amount: string;
  total_supply_raw: number | null;
  decimals: number | null;
  lock_bps: number | null;
  cliff_ts: string;
  status: LockStatus;
  canonical: boolean;
  last_verified_at: string | null;
}

/** Full `locks` row (service-role reads only). */
export interface LockRow extends LockPublicRow {
  cluster: string;
  escrow_ata: string;
  cliff_ts_raw: number;
  creation_signature: string;
  creation_slot: number;
  last_verified_signature: string | null;
  last_verified_slot: number | null;
  created_at: string;
}

export type WebhookProvider = "helius";

/** Normalized, bounded subset persisted from a Helius enhanced webhook event. */
export interface WebhookInboxPayload {
  signature: string;
  slot: number | null;
  accountKeys: string[];
}

export interface WebhookInboxRow {
  id: string;
  provider: WebhookProvider;
  signature: string;
  event_index: number;
  event_type: string;
  slot: number | null;
  payload_hash: string;
  payload: WebhookInboxPayload;
  attempts: number;
  locked_until: string | null;
  next_retry_at: string | null;
  processed_at: string | null;
  dead_lettered: boolean;
  received_at: string;
}

/** SAS attestation block shape, wired later by the SAS branch. Nullable here. */
export interface AttestationBlock {
  pda: string;
  programId: string;
  credentialPda: string;
  schemaPda: string;
  schemaVersion: number;
  expiryTs: string;
}

/** Derived tier projection: the single authority over trust state. */
export interface TrustProjection {
  tier: TrustTier;
  tierComputedAt: string;
  policyVersion: number;
  /** Lock evidence state after applying wall-clock eligibility to the record. */
  lockStatus: LockStatus | null;
  /** True when the lock is time-eligible/withdrawn, i.e. no longer holding tier. */
  isExpired: boolean;
}
