import "server-only";

import { getServerClient } from "@/lib/supabase";
import { isSasEnabled } from "./config";
import { triggerAttestation, triggerCloseAttestation } from "./trigger";
import { TRUST_TIER, type TrustTierValue } from "./schema";
import { type LockChainFacts } from "./evidence";

/**
 * Finalized-lock issuance trigger, called from the token record persistence path.
 * Enqueues (or reissues) a trust attestation for a token whose lock just verified
 * on chain. Behind SAS_ENABLED and fully NON-BLOCKING: a failure here never fails
 * the record request, because issuance is a durable outbox side effect, not part
 * of the launch's correctness. Errors are logged and swallowed.
 *
 * The identity fields come from the finalized token row (single source), and the
 * numeric snapshot from the finalized lock facts. The outbox worker reconstructs
 * the SAME evidence from the same row + persisted snapshot, so the enqueued
 * evidence hash and the worker's reconstruction agree by construction.
 *
 * TODO(trust-api): the finalized TOTAL supply denominator and the projected tier
 * are the trust projection's authority. Until feature/trust-api lands, the
 * denominator is the finalized launch purchase basis and the tier is LOCKED at
 * record time; the tier recompute cron reissues on any later upgrade.
 */
export interface FinalizedLockInput {
  mint: string;
  creator: string;
  streamId: string;
  /** Locked deposit amount, raw base units. */
  lockedAmount: bigint;
  /** Finalized supply basis for the bps denominator, raw base units. */
  supplyBasis: bigint;
  /** Unlock cliff as chain seconds; also the attestation expiry. */
  cliffTs: bigint;
  github: string;
  /** Projected tier at record time (LOCKED unless the projection says higher). */
  tier?: TrustTierValue;
}

export async function triggerFinalizedLockAttestation(input: FinalizedLockInput): Promise<void> {
  if (!isSasEnabled()) return;
  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("tokens")
      .select("id")
      .eq("mint_address", input.mint)
      .maybeSingle();
    if (error || !data) return;
    const tokenId = (data as { id: string }).id;

    // Persist the supply basis so the tier-recompute cron recomputes the same
    // lock_bps later. Best-effort: a write failure only skips this issuance.
    await client
      .from("tokens")
      .update({ sas_supply_basis: input.supplyBasis.toString() })
      .eq("id", tokenId);

    const facts: LockChainFacts = {
      mint: input.mint,
      creator: input.creator,
      streamId: input.streamId,
      lockedAmount: input.lockedAmount,
      totalSupply: input.supplyBasis,
      cliffTs: input.cliffTs,
    };

    await triggerAttestation({
      tokenId,
      facts,
      tier: input.tier ?? TRUST_TIER.LOCKED,
      github: input.github,
    });
  } catch (err) {
    console.error("[sas] finalized-lock attestation trigger failed:", err);
  }
}

/**
 * Tier/evidence transition trigger, called from the tier-recompute cron when a
 * token's projected tier changes (up or down). Behind SAS_ENABLED and NON-
 * BLOCKING: a failure never fails the cron. Reads the token's finalized lock
 * facts (including the persisted supply basis) and the live attestation's
 * evidence hash, then enqueues a reissue if the claim actually changed.
 */
export interface TierTransitionInput {
  tokenId: string;
  newTier: TrustTierValue;
}

export async function triggerTierTransitionAttestation(input: TierTransitionInput): Promise<void> {
  if (!isSasEnabled()) return;
  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("tokens")
      .select("mint_address, creator_wallet, lock_metadata_id, github_username, lock_amount, sas_supply_basis, lock_unlock_at")
      .eq("id", input.tokenId)
      .maybeSingle();
    if (error || !data) return;
    const row = data as {
      mint_address: string;
      creator_wallet: string;
      lock_metadata_id: string | null;
      github_username: string | null;
      lock_amount: string | null;
      sas_supply_basis: string | null;
      lock_unlock_at: string | null;
    };

    // Without a stream, a supply basis, a lock amount, or a cliff there is no
    // finalized claim to attest: skip silently.
    if (
      !row.lock_metadata_id ||
      !row.sas_supply_basis ||
      !/^\d+$/.test(row.sas_supply_basis) ||
      !row.lock_amount ||
      !/^\d+$/.test(row.lock_amount) ||
      !row.lock_unlock_at
    ) {
      return;
    }

    // The live attestation's evidence hash decides issue-vs-reissue and provides
    // the idempotency guard (an unchanged claim never reissues). Its stored
    // policy/schema versions travel with it so a version bump reissues even when
    // the hash is unchanged (schema_version is pinned by the schema PDA, separate
    // from the evidence claim).
    const { data: liveRow } = await client
      .from("attestations")
      .select("evidence_hash, policy_version, schema_version")
      .eq("mint", row.mint_address)
      .in("status", ["pending", "submitted", "finalized"])
      .order("generation", { ascending: false })
      .limit(1)
      .maybeSingle();
    const live = liveRow as
      | { evidence_hash: string; policy_version: number; schema_version: number }
      | null;
    const currentEvidenceHash = live?.evidence_hash ?? null;

    const facts: LockChainFacts = {
      mint: row.mint_address,
      creator: row.creator_wallet,
      streamId: row.lock_metadata_id,
      lockedAmount: BigInt(row.lock_amount),
      totalSupply: BigInt(row.sas_supply_basis),
      cliffTs: BigInt(Math.floor(new Date(row.lock_unlock_at).getTime() / 1000)),
    };

    await triggerAttestation({
      tokenId: input.tokenId,
      facts,
      tier: input.newTier,
      github: row.github_username ?? "",
      currentEvidenceHash,
      currentPolicyVersion: live?.policy_version ?? null,
      currentSchemaVersion: live?.schema_version ?? null,
    });
  } catch (err) {
    console.error("[sas] tier-transition attestation trigger failed:", err);
  }
}

/**
 * Expired-lock revocation trigger, called from the tier-recompute cron when a
 * lock's cliff has passed. The finalized claim has ended, so the on-chain
 * attestation must be CLOSED, not reissued: a reissue would derive a past cliff,
 * close the old account, then dead-letter the impossible past-expiry create.
 * Behind SAS_ENABLED and NON-BLOCKING. No-ops when there is no live attestation.
 */
export interface ExpiredLockInput {
  tokenId: string;
}

/**
 * The result of driving an expired-lock close, used by the cron to decide whether
 * the durable revocation marker can be advanced (serviced_rev := requested_rev):
 *   * "enqueued"           -> a close-only job is durably queued; the request is
 *                             serviced, advance the marker.
 *   * "nothing_to_revoke"  -> there is provably no live attestation AND no in-flight
 *                             issuance that could create a replacement; the request
 *                             is a no-op, advance the marker.
 *   * "retry"              -> the marker MUST stay pending: SAS is disabled (a
 *                             previously issued attestation may still be live and can
 *                             only be revoked once SAS is re-enabled), a transient
 *                             failure occurred, OR an issuance/reissue is in flight
 *                             whose attestation row does not exist yet (or was
 *                             transiently absent) and would leave an unclosed
 *                             replacement. The next cron pass re-drives.
 */
export type ExpiredCloseOutcome = "enqueued" | "nothing_to_revoke" | "retry";

/** Live state observed while driving an expired-lock close, fed to the pure decision. */
export interface ExpiredCloseState {
  /** SAS_ENABLED: false means a live attestation may exist that we cannot revoke yet. */
  sasEnabled: boolean;
  /** null on a transient read/config failure (retry); undefined when not yet read. */
  hasOpenIssuanceJob?: boolean | null;
  /** null on a transient read failure; a string/"" when read; undefined when not read. */
  currentEvidenceHash?: string | null;
  /** The close trigger's reason when it declined to enqueue, if it was called. */
  closeDeclinedReason?: "disabled" | "unconfigured" | "no_live_attestation";
  /** True when the close trigger durably enqueued a close job. */
  closeEnqueued?: boolean;
}

/**
 * Pure marker decision for an expired-lock close. Encodes the three unsafe-clear
 * fixes so they are unit-testable without a database:
 *   1. SAS disabled -> retry (never clear; a live attestation may still exist).
 *   2. An in-flight issue/reissue job -> retry (a replacement may be created that a
 *      close driven now would miss); also retry when the open-job read failed.
 *   3. Terminal outcomes (close enqueued, or provably no live attestation and no
 *      open job) -> advance the marker; every other decline retries.
 */
export function decideCloseOutcome(state: ExpiredCloseState): ExpiredCloseOutcome {
  // Item 1: SAS disabled never clears the marker.
  if (!state.sasEnabled) return "retry";
  // Item 2: an in-flight reissue (or a failed open-job read) must retry so the
  // replacement attestation is closed once the reissue settles.
  if (state.hasOpenIssuanceJob === null) return "retry";
  if (state.hasOpenIssuanceJob === true) return "retry";
  // A transient live-attestation read failure retries rather than clearing.
  if (state.currentEvidenceHash === null) return "retry";
  // Nothing open and nothing live: provably nothing to revoke.
  if (!state.currentEvidenceHash) return "nothing_to_revoke";
  // A live attestation exists and nothing is in flight: the close was attempted.
  if (state.closeEnqueued) return "enqueued";
  // The close declined after we proved nothing is in flight: only a row that
  // vanished with no replacement is a genuine no-op; disabled/unconfigured (config
  // changed under us) retries rather than stranding a possibly-live attestation.
  return state.closeDeclinedReason === "no_live_attestation" ? "nothing_to_revoke" : "retry";
}

/**
 * Whether the cron may advance the serviced rev, mirroring the SQL guard in
 * clear_expired_close_marker. The marker is monotonic: the cron records the rev it
 * OBSERVED at fetch time, and may only advance serviced_rev to it when no newer
 * request has bumped requested_rev since. A newer request (higher requested_rev)
 * leaves the token pending so its replacement attestation is closed on the next pass;
 * a boolean marker could not represent that newer request and would erase it.
 */
export function shouldAdvanceServicedRev(
  observedRequestedRev: number,
  currentRequestedRev: number,
  currentServicedRev: number,
): boolean {
  return currentRequestedRev === observedRequestedRev && currentServicedRev < observedRequestedRev;
}

export async function triggerExpiredLockClose(input: ExpiredLockInput): Promise<ExpiredCloseOutcome> {
  // SAS disabled does NOT clear the marker: a previously issued on-chain attestation
  // may still be live, and this deployment cannot revoke it while disabled. Leave the
  // request pending so revocation happens once SAS is re-enabled (or an operator runs
  // the close). Clearing here would silently strand a live attestation open forever.
  if (!isSasEnabled()) return "retry";
  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("tokens")
      .select("mint_address, creator_wallet, lock_metadata_id, github_username, lock_amount, sas_supply_basis, lock_unlock_at")
      .eq("id", input.tokenId)
      .maybeSingle();
    // A transient read failure must retry, not silently clear the marker.
    if (error) return "retry";
    if (!data) return "nothing_to_revoke";
    const row = data as {
      mint_address: string;
      creator_wallet: string;
      lock_metadata_id: string | null;
      github_username: string | null;
      lock_amount: string | null;
      sas_supply_basis: string | null;
      lock_unlock_at: string | null;
    };

    // An in-flight issue/reissue is decisive regardless of what the attestation
    // read shows. Between our read and the close enqueue, a reissue can transiently
    // present NO live attestation (the close half ran, the create half has not) and
    // then create a replacement that our close would never cover. So whenever an
    // open outbox job exists for this token, retry and let the cron re-drive after
    // the reissue settles, closing the replacement then. Only when nothing is open
    // do we trust the attestation read to decide enqueue-vs-noop.
    const hasOpenJob = await hasOpenIssuanceJob(client, input.tokenId);
    if (hasOpenJob === null || hasOpenJob) {
      return decideCloseOutcome({ sasEnabled: true, hasOpenIssuanceJob: hasOpenJob });
    }

    // No issuance in flight: the live attestation read is now stable. Only close a
    // live attestation; if there is none there is provably nothing to revoke.
    const { data: liveRow, error: liveErr } = await client
      .from("attestations")
      .select("evidence_hash")
      .eq("mint", row.mint_address)
      .in("status", ["pending", "submitted", "finalized"])
      .order("generation", { ascending: false })
      .limit(1)
      .maybeSingle();
    // A transient read failure must retry, not clear the marker.
    if (liveErr) {
      return decideCloseOutcome({ sasEnabled: true, hasOpenIssuanceJob: false, currentEvidenceHash: null });
    }
    const currentEvidenceHash = (liveRow as { evidence_hash: string } | null)?.evidence_hash ?? "";
    if (!currentEvidenceHash) {
      // Nothing live and nothing open: provably nothing to revoke.
      return decideCloseOutcome({
        sasEnabled: true,
        hasOpenIssuanceJob: false,
        currentEvidenceHash: "",
      });
    }

    // The facts only satisfy the outbox payload constraints; the worker's close
    // path never issues from them. Fall back to safe placeholders when the lock
    // fields are absent so the positive-value constraints still hold.
    const supplyBasis =
      row.sas_supply_basis && /^\d+$/.test(row.sas_supply_basis) ? BigInt(row.sas_supply_basis) : BigInt(1);
    const lockedAmount =
      row.lock_amount && /^\d+$/.test(row.lock_amount) ? BigInt(row.lock_amount) : BigInt(0);
    const cliffTs = row.lock_unlock_at
      ? BigInt(Math.floor(new Date(row.lock_unlock_at).getTime() / 1000))
      : BigInt(1);

    const facts: LockChainFacts = {
      mint: row.mint_address,
      creator: row.creator_wallet,
      streamId: row.lock_metadata_id ?? "",
      lockedAmount,
      totalSupply: supplyBasis,
      cliffTs: cliffTs > BigInt(0) ? cliffTs : BigInt(1),
    };

    const outcome = await triggerCloseAttestation({
      tokenId: input.tokenId,
      mint: row.mint_address,
      facts,
      tier: TRUST_TIER.LOCKED,
      github: row.github_username ?? "",
      currentEvidenceHash,
    });
    return decideCloseOutcome({
      sasEnabled: true,
      hasOpenIssuanceJob: false,
      currentEvidenceHash,
      closeEnqueued: outcome.enqueued,
      closeDeclinedReason: outcome.enqueued ? undefined : outcome.reason,
    });
  } catch (err) {
    // A throw is transient (enqueue RPC failure, etc.): retry on the next pass
    // rather than dropping the revocation.
    console.error("[sas] expired-lock close trigger failed:", err);
    return "retry";
  }
}

/**
 * Whether an issue/reissue outbox job for this token is still open (pending,
 * leased, or broadcast). Returns null on a transient read failure so the caller
 * retries rather than treating an error as "no open job". An open job means a
 * replacement attestation may still be created, so any close driven now could miss
 * it: the caller must retry until the issuance settles.
 */
async function hasOpenIssuanceJob(
  client: ReturnType<typeof getServerClient>,
  tokenId: string,
): Promise<boolean | null> {
  const { data, error } = await client
    .from("attestation_outbox")
    .select("id")
    .eq("token_id", tokenId)
    .in("operation", ["issue", "reissue"])
    .in("status", ["pending", "leased", "broadcast"])
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return !!data;
}
