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
- [x] Restore the reviewed atomic deployment after the dirty non-ALT CLI artifact caused deterministic transaction serialization failures.
- [ ] Run a disposable-wallet mainnet launch after explicit approval of a SOL spending cap.
- [ ] Add the LCKD contract address after the manual token launch and finalized receipt review.
- [ ] Monitor upstream remediation for the transitive `bigint-buffer` advisory.
