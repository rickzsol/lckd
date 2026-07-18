# feature/sas-attestations — known issues at push time

This branch went through five independent review rounds. One concurrency residual remains and is documented here rather than fixed with a blind sixth pass, because the fix is a design choice that wants a human decision.

## Open (1)

### Atomic reissue-vs-close race in the expired-lock revocation path

**Where:** `src/lib/sas/lockTrigger.ts` (`decideCloseOutcome` / `hasOpenIssuanceJob`), the expired-lock close driver.

**What:** The check for an in-flight issuance job and the close decision are not atomic. A reissue can begin *after* the open-job check passes, remove the live attestation account, cause the close driver to observe `nothing_to_revoke`, advance the serviced revision, and then create a replacement attestation after the marker has been cleared. Net effect: in a narrow interleaving, an expired lock's replacement attestation can survive instead of being revoked.

**Why it is not yet fixed:** Closing the window requires serializing the close decision against issuance nonce renewal. That is a design decision, not a mechanical patch. Options:
1. Take a per-token advisory lock (`pg_advisory_xact_lock` on the token id) around both the issuance nonce assignment and the close decision, so they cannot interleave.
2. Make the attestation nonce/generation monotonic and have the close driver assert the generation it observed is the one it closes, retrying if a newer generation appeared (compare-and-close).
3. Model close and issue as mutually exclusive states on the outbox row so a reissue cannot start while a close is being decided.

Recommendation: option 1 (advisory lock) is the smallest correct change and matches the durable-marker approach already in this branch. It should be paired with a Postgres-16 test that interleaves a reissue and an expiry close.

**Blast radius:** requires SAS_ENABLED=true (attestations off by default), an expired lock, and a reissue racing the close driver in the same window. It cannot corrupt lock or launch state; it can only leave one stale on-chain attestation live past its lock. Attestation expiry is bound to the lock cliff, so the stale attestation is already expired on-chain and any correct verifier (pinned PDA + expiry check, per verify.ts) rejects it. The residual is a cleanup/hygiene gap, not a trust-signal forgery vector.

## Resolved across review (for reference)

Broadcast-vs-finalized reconciliation, lease fencing on completion RPCs, false-finalized close, parked-successor latest-wins, enqueue ON CONFLICT retry loop, public read grants, verify.ts paused-schema + cliff==expiry binding, live-state idempotency, cluster/RPC binding + genesis check, trust-anchor descriptor mismatch guard, SAS-disabled does not clear the marker, monotonic close-revision marker. All migration RPCs validated on local Postgres 16.

Trust API response `anchor` field is an intentional cross-branch seam (`TODO(trust-api)`); it is provided by feature/trust-api, not this branch.
