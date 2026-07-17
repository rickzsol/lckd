# Tasks

## Production release

- [x] Build one atomic Pump create, reviewed buy, Streamflow cliff lock, and ALT deactivation transaction.
- [x] Enforce exact Streamflow v13 accounts, payload, permissions, PDAs, ATAs, programs, and finalized state.
- [x] Add durable authenticated recovery, immutable issuance tuples, CAS transitions, expiry guards, and exact confirmed/finalized reconciliation.
- [x] Add wallet-authorized ALT deactivate/close recovery with cooldown enforcement.
- [x] Bind recorded percentages to finalized purchase and Streamflow deposit amounts.
- [x] Replace mock landing statistics with aggregate production data.
- [x] Add the manual LCKD directory entry, detail page, links, and final token image.
- [x] Provision staging and production Supabase projects and apply migrations 001-007.
- [x] Configure production Vercel Supabase, Helius, Pinata, GitHub OAuth, NextAuth, origin, and mainnet settings.
- [x] Pass tests, typecheck, lint, production build, database lint/advisors, source secret scan, and independent review.
- [ ] Run a disposable-wallet mainnet launch after explicit approval of a SOL spending cap.
- [ ] Add the LCKD contract address after the manual token launch and finalized receipt review.
- [ ] Monitor upstream remediation for the transitive `bigint-buffer` advisory.

## SAS attestations review fixes (feature/sas-attestations)

- [x] Wire triggerAttestation into the record persistence path and tier recompute cron behind SAS_ENABLED.
- [x] Reconcile broadcast jobs by persisted signature (confirmed or finalized), never resend.
- [x] Close jobs close the DB row via a dedicated RPC without inserting a false generation.
- [x] Require markBroadcast success and fence completion on lease/status/signature.
- [x] Retain a successor snapshot when trust changes during leased/broadcast work.
- [x] Serve public reads from an owner-executed projected view; anon denied on the base table.
- [x] Enforce cliff==expiry and reject paused schemas in the verifier and the published example.
- [x] Drive the worker from live chain state; model reissue as two durable phases.
- [x] Compare the full evidence hash in decideIssuance, not four gating fields.
- [x] Make first enqueue atomic (insert-on-conflict) against concurrent races.
- [x] Persist policy and schema versions in the job and complete from the snapshot.
- [x] Bind cluster-specific RPC and verify the genesis hash before signing.
- [x] Add devnet E2E covering the two-phase close-and-recreate path.

## SAS attestations round 3 confirmation fixes (feature/sas-attestations)

- [x] 2a: preserve the claimed-from status through broadcast recovery; keep RETURN QUERY.
- [x] 2b: only treat FINALIZED as landed; confirmed waits without advancing or re-driving.
- [x] 5: keep only the latest desired state in the successor slot; never promote a stale snapshot.
- [x] 10: guard the lost-insert fallback with ON CONFLICT on the open-job index.
- [x] 1: reissue on policy/schema version bump; add the getTrustAnchorDescriptor trust-api seam.
- [x] NEW: enqueue a CLOSE-ONLY job on expired-lock/downgrade, never a reissue.
- [x] 12: assert job.cluster == config cluster before signing; mismatch fails without broadcasting.
- [x] Add tests: finalization-wait, claimed-from recovery, parked-successor latest-wins, close-only, cluster-mismatch.
- [x] Re-verify migration + RPCs on local Postgres 16 via supabase/tests/attestation_outbox_rpcs.test.sql.
