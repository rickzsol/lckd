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
 * the durable `sas_close_pending` marker can be cleared:
 *   * "enqueued"           -> a close-only job is durably queued; clear the marker.
 *   * "nothing_to_revoke"  -> there is provably no live attestation to close (and
 *                             SAS is disabled/unconfigured is folded in here too);
 *                             clear the marker, the revocation is a no-op.
 *   * "retry"              -> a transient failure (or an in-flight issuance whose
 *                             attestation row does not exist yet); KEEP the marker
 *                             so the next cron pass re-drives the close.
 */
export type ExpiredCloseOutcome = "enqueued" | "nothing_to_revoke" | "retry";

export async function triggerExpiredLockClose(input: ExpiredLockInput): Promise<ExpiredCloseOutcome> {
  // SAS disabled: there is nothing this deployment can revoke on chain, so the
  // marker is safe to clear rather than accumulate forever.
  if (!isSasEnabled()) return "nothing_to_revoke";
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

    // Only close a live attestation; if there is none there is nothing to revoke.
    const { data: liveRow, error: liveErr } = await client
      .from("attestations")
      .select("evidence_hash")
      .eq("mint", row.mint_address)
      .in("status", ["pending", "submitted", "finalized"])
      .order("generation", { ascending: false })
      .limit(1)
      .maybeSingle();
    // A transient read failure must retry, not clear the marker.
    if (liveErr) return "retry";
    const currentEvidenceHash = (liveRow as { evidence_hash: string } | null)?.evidence_hash ?? null;
    if (!currentEvidenceHash) {
      // No live attestation yet. If an issuance is still IN FLIGHT (an open outbox
      // issue/reissue job for this token), the attestation row simply does not
      // exist yet: keep the marker and retry once issuance lands, so an in-flight
      // issuance is never permanently missed. Only when nothing is open AND nothing
      // is live is there provably nothing to revoke.
      const { data: openJob, error: openErr } = await client
        .from("attestation_outbox")
        .select("id")
        .eq("token_id", input.tokenId)
        .in("operation", ["issue", "reissue"])
        .in("status", ["pending", "leased", "broadcast"])
        .limit(1)
        .maybeSingle();
      if (openErr) return "retry";
      return openJob ? "retry" : "nothing_to_revoke";
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
    if (outcome.enqueued) return "enqueued";
    // The close trigger declined: unconfigured/disabled is a genuine no-op, but a
    // no_live_attestation here means the row disappeared between our read and the
    // enqueue, so nothing remains to revoke.
    return "nothing_to_revoke";
  } catch (err) {
    // A throw is transient (enqueue RPC failure, etc.): retry on the next pass
    // rather than dropping the revocation.
    console.error("[sas] expired-lock close trigger failed:", err);
    return "retry";
  }
}
