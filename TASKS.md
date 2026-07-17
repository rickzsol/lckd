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

## Trust API + unlock calendar (branch feature/trust-api)

- [x] Migration `20260718000000_trust_locks.sql`: locks + webhook_inbox, RLS + safe definer view, lease RPC, projection columns.
- [x] Trust projection module; retire the wall-clock downgrade in cron and queries.
- [x] Public `GET /token/:ca/trust` and `GET /unlocks` with envelope, keyset pagination, and credentialless CORS.
- [x] Hardened `POST /webhooks/helius` receiver; leased inbox consumer and bounded reconciliation sweep.
- [x] `/unlocks` page, navbar, sitemap, OG, feed strip, and API docs.
- [x] Backfill and Helius webhook tools.
- [x] Unit tests (116 pass), typecheck, lint, production build green; internal review fix applied.
- [ ] Run the blocking Codex diff review (Codex CLI unavailable in this WSL env).
- [ ] Wire the SAS attestation block into the trust response (separate branch).
- [ ] Apply migration after dry-run, run staged backfill, then the NOT NULL follow-up migration.
- [ ] Set `HELIUS_WEBHOOK_SECRET` and `NEXT_PUBLIC_SITE_URL`; register the Helius webhook.
