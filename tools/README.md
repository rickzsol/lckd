# tools

## sas-devnet-e2e.ts

Devnet end-to-end for the Solana Attestation Service flow: create credential,
create schema, issue attestation, read back and verify, close. Devnet only. It
refuses to run on any other cluster and never creates real credentials in CI or
tests.

```
npm run sas:e2e
```

Keys load from env or file paths and are never committed:

- `SAS_E2E_ISSUER_SECRET` cold credential authority (base58 or JSON 64-byte array)
- `SAS_E2E_SIGNER_SECRET` hot authorized signer
- `SAS_E2E_PAYER_SECRET` fee payer (funded on devnet)

If unset, ephemeral keypairs are generated and the payer is airdropped.

### Cold-authority ceremony (mainnet, run once)

Run off the server's hot path, ideally on an air-gapped machine.

1. Generate the credential authority key (prefer a multisig or KMS-held key). It
   signs credential + schema creation and signer rotation only, then returns to
   cold storage.
2. Generate a separate hot signer key; the server holds only this
   (`SAS_SIGNER_SECRET`) and it signs attestation create/close.
3. Generate a separate fee payer key (`SAS_FEE_PAYER_SECRET`); fund it and alert
   when its balance drops below 0.05 SOL.
4. With the cold authority, create the `LCKD` credential with the hot signer as
   the single authorized signer, then create the `lckd-trust-v1` schema. Record
   the credential PDA and schema PDA; publish them as `SAS_CREDENTIAL_PDA` /
   `SAS_SCHEMA_PDA` and on `/api-docs`.
5. The cold authority touches nothing else until a signer rotation is needed.

### Compromised-signer runbook (hot signer leaks)

1. Rotate: with the cold authority, call `getChangeAuthorizedSignersInstruction`
   to replace the leaked signer with a fresh one. Update `SAS_SIGNER_SECRET`.
2. Enumerate: scan attestations issued in the compromise window whose stored
   `evidence_hash` does not match a fresh server-side recomputation of the claim.
   A mismatch means an attacker-forged payload.
3. Close: close each mismatched attestation (reclaims rent, invalidates it).
4. Publish the incident: window, affected mints, and remediation.

The same ceremony and runbook are duplicated in the header of
`sas-devnet-e2e.ts` so they travel with the script.
