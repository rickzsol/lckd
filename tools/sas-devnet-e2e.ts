/**
 * SAS devnet end-to-end: create credential -> create schema -> issue attestation
 * -> read back + verify -> close. DEVNET ONLY. Never touches mainnet. Never
 * creates real credentials in CI or tests.
 *
 * Run: npm run sas:e2e
 *
 * Keys are loaded from env or file paths and are NEVER committed:
 *   SAS_E2E_ISSUER_SECRET   cold credential authority (base58 or JSON 64-byte array)
 *   SAS_E2E_SIGNER_SECRET   hot authorized signer
 *   SAS_E2E_PAYER_SECRET    fee payer (funded on devnet)
 * If unset, ephemeral keypairs are generated and the payer is airdropped.
 *
 * ---------------------------------------------------------------------------
 * Cold-authority ceremony (mainnet, run once, off this machine's hot path):
 *   1. Generate the credential authority key on an air-gapped machine (ideally a
 *      multisig or KMS-held key). It signs credential + schema creation and
 *      signer rotation ONLY, then goes back to cold storage.
 *   2. Generate a separate hot signer key. It is the only key the server holds
 *      (SAS_SIGNER_SECRET) and it signs attestation create/close.
 *   3. Generate a separate fee payer key (SAS_FEE_PAYER_SECRET); fund it and
 *      alert when balance < 0.05 SOL.
 *   4. With the cold authority: create the LCKD credential (name "LCKD") with the
 *      hot signer as the single authorized signer, then create the lckd-trust-v1
 *      schema. Record the credential PDA and schema PDA; publish them as
 *      SAS_CREDENTIAL_PDA / SAS_SCHEMA_PDA and on /api-docs.
 *   5. The cold authority touches nothing else until a signer rotation is needed.
 *
 * Compromised-signer runbook (hot signer leaks):
 *   1. Rotate: with the cold authority, call getChangeAuthorizedSignersInstruction
 *      to replace the leaked signer with a fresh one. Update SAS_SIGNER_SECRET.
 *   2. Enumerate: scan attestations issued in the compromise window whose stored
 *      evidence_hash does not match a fresh server-side recomputation of the
 *      claim (evidence_hash mismatch = attacker-forged payload).
 *   3. Close: close each mismatched attestation (reclaims rent, invalidates it).
 *   4. Publish the incident: window, affected mints, and remediation.
 * ---------------------------------------------------------------------------
 */

import {
  airdropFactory,
  createSolanaClient,
  createTransaction,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  lamports,
  signTransactionMessageWithSigners,
  createKeyPairSignerFromBytes,
  type KeyPairSigner,
  type SolanaClient,
} from "gill";
import {
  deriveAttestationPda,
  deriveCredentialPda,
  deriveEventAuthorityAddress,
  deriveSchemaPda,
  fetchMaybeAttestation,
  getCloseAttestationInstruction,
  getCreateAttestationInstruction,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
} from "sas-lib";
import bs58 from "bs58";
import { readFileSync } from "fs";

import {
  SCHEMA_DESCRIPTION,
  SCHEMA_FIELDS,
  SCHEMA_LAYOUT,
  SCHEMA_NAME,
  SCHEMA_VERSION,
  TRUST_TIER,
  serializeTrustData,
  deserializeTrustData,
} from "../src/lib/sas/schema";
import { verifyTrustAttestation } from "../src/lib/sas/verify";

const CREDENTIAL_NAME = "LCKD";

function loadSecret(value: string): Uint8Array {
  const trimmed = value.trim();
  const raw = trimmed.startsWith("/") || trimmed.endsWith(".json")
    ? readFileSync(trimmed, "utf8").trim()
    : trimmed;
  if (raw.startsWith("[")) {
    const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
    if (bytes.length !== 64) throw new Error("Secret JSON must be 64 bytes");
    return bytes;
  }
  const decoded = bs58.decode(raw);
  if (decoded.length !== 64) throw new Error("Secret must decode to 64 bytes");
  return decoded;
}

async function signerFromEnv(name: string): Promise<KeyPairSigner | null> {
  const value = process.env[name];
  if (!value) return null;
  return createKeyPairSignerFromBytes(loadSecret(value));
}

async function send(
  client: SolanaClient,
  payer: KeyPairSigner,
  instructions: Parameters<typeof createTransaction>[0]["instructions"],
  label: string,
): Promise<string> {
  const { value: latestBlockhash } = await client.rpc.getLatestBlockhash().send();
  const message = createTransaction({
    version: "legacy",
    feePayer: payer,
    instructions,
    latestBlockhash,
    computeUnitLimit: 200_000,
    computeUnitPrice: 1,
  });
  const simulation = await client.simulateTransaction(message);
  if (simulation.value.err) {
    throw new Error(`${label} simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }
  const signed = await signTransactionMessageWithSigners(message);
  await client.sendAndConfirmTransaction(signed, { commitment: "confirmed" });
  const signature = getSignatureFromTransaction(signed);
  console.log(`    - ${label}: ${signature}`);
  return signature;
}

async function main() {
  const cluster = (process.env.SAS_CLUSTER ?? "devnet").trim();
  if (cluster !== "devnet") {
    throw new Error("sas:e2e refuses to run on any cluster but devnet");
  }
  const client = createSolanaClient({ urlOrMoniker: "devnet" });
  console.log("SAS devnet e2e\n");

  const payer = (await signerFromEnv("SAS_E2E_PAYER_SECRET")) ?? (await generateKeyPairSigner());
  const issuer = (await signerFromEnv("SAS_E2E_ISSUER_SECRET")) ?? (await generateKeyPairSigner());
  const signer = (await signerFromEnv("SAS_E2E_SIGNER_SECRET")) ?? (await generateKeyPairSigner());
  const tokenMint = await generateKeyPairSigner();

  if (!process.env.SAS_E2E_PAYER_SECRET) {
    console.log("1. Airdropping payer...");
    const airdrop = airdropFactory({ rpc: client.rpc, rpcSubscriptions: client.rpcSubscriptions });
    await airdrop({
      commitment: "confirmed",
      lamports: lamports(BigInt(1_000_000_000)),
      recipientAddress: payer.address,
    });
  }

  console.log("2. Creating credential...");
  const [credentialPda] = await deriveCredentialPda({ authority: issuer.address, name: CREDENTIAL_NAME });
  await send(client, payer, [
    getCreateCredentialInstruction({
      payer,
      credential: credentialPda,
      authority: issuer,
      name: CREDENTIAL_NAME,
      signers: [signer.address],
    }),
  ], "credential");
  console.log(`    - credential PDA: ${credentialPda}`);

  console.log("3. Creating schema...");
  const [schemaPda] = await deriveSchemaPda({
    credential: credentialPda,
    name: SCHEMA_NAME,
    version: SCHEMA_VERSION,
  });
  await send(client, payer, [
    getCreateSchemaInstruction({
      authority: issuer,
      payer,
      name: SCHEMA_NAME,
      credential: credentialPda,
      description: SCHEMA_DESCRIPTION,
      fieldNames: [...SCHEMA_FIELDS],
      schema: schemaPda,
      layout: Buffer.from(SCHEMA_LAYOUT),
    }),
  ], "schema");
  console.log(`    - schema PDA: ${schemaPda}`);

  console.log("4. Issuing attestation...");
  const cliffTs = BigInt(Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60);
  const data = {
    mint: tokenMint.address.toString(),
    creator: payer.address.toString(),
    stream_id: schemaPda.toString(),
    tier: TRUST_TIER.BUILDER,
    lock_bps: 6500,
    cliff_ts: cliffTs,
    policy_version: 1,
    github: "octocat",
  };
  const [attestationPda] = await deriveAttestationPda({
    credential: credentialPda,
    schema: schemaPda,
    nonce: tokenMint.address,
  });
  await send(client, payer, [
    getCreateAttestationInstruction({
      payer,
      authority: signer,
      credential: credentialPda,
      schema: schemaPda,
      attestation: attestationPda,
      nonce: tokenMint.address,
      expiry: cliffTs,
      data: serializeTrustData(data),
    }),
  ], "attestation");
  console.log(`    - attestation PDA: ${attestationPda}`);

  console.log("5. Reading back + verifying...");
  const account = await fetchMaybeAttestation(client.rpc, attestationPda);
  if (!account.exists) throw new Error("attestation not found after issue");
  const decoded = deserializeTrustData(account.data.data as Uint8Array);
  console.log("    - decoded:", JSON.stringify(decoded, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

  const result = await verifyTrustAttestation(
    client.rpc,
    { credentialPda, schemaPda },
    tokenMint.address.toString(),
  );
  if (!result.verified) throw new Error(`verification failed: ${result.reason}`);
  console.log("    - verified: true");

  // Two-phase reissue: close the current generation, then recreate a fresh one
  // with an upgraded tier. Each phase is its OWN transaction with its OWN
  // signature, mirroring the durable outbox worker. A single close+create
  // transaction is deliberately NOT used: an ambiguous send could not be
  // reconciled by a single signature, and devnet verification of that combined
  // path is unavailable here.
  console.log("6. Reissue phase 1 - closing the current generation...");
  const eventAuthority = await deriveEventAuthorityAddress();
  const closePhaseSig = await send(client, payer, [
    getCloseAttestationInstruction({
      payer,
      attestation: attestationPda,
      authority: signer,
      credential: credentialPda,
      eventAuthority,
      attestationProgram: SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
    }),
  ], "reissue-close");
  const afterReissueClose = await fetchMaybeAttestation(client.rpc, attestationPda);
  if (afterReissueClose.exists) throw new Error("attestation still exists after reissue close");
  console.log(`    - reissue close signature: ${closePhaseSig}`);

  console.log("7. Reissue phase 2 - recreating at an upgraded tier...");
  const reissueData = { ...data, tier: TRUST_TIER.SHIPPED };
  const createPhaseSig = await send(client, payer, [
    getCreateAttestationInstruction({
      payer,
      authority: signer,
      credential: credentialPda,
      schema: schemaPda,
      attestation: attestationPda,
      nonce: tokenMint.address,
      expiry: cliffTs,
      data: serializeTrustData(reissueData),
    }),
  ], "reissue-create");
  if (createPhaseSig === closePhaseSig) throw new Error("reissue phases must have distinct signatures");

  const reissued = await fetchMaybeAttestation(client.rpc, attestationPda);
  if (!reissued.exists) throw new Error("attestation not found after reissue create");
  const reissuedDecoded = deserializeTrustData(reissued.data.data as Uint8Array);
  if (reissuedDecoded.tier !== TRUST_TIER.SHIPPED) {
    throw new Error(`reissue did not upgrade tier: got ${reissuedDecoded.tier}`);
  }
  const reissueVerify = await verifyTrustAttestation(
    client.rpc,
    { credentialPda, schemaPda },
    tokenMint.address.toString(),
  );
  if (!reissueVerify.verified) throw new Error(`reissue verification failed: ${reissueVerify.reason}`);
  if (reissueVerify.verified && reissueVerify.data.tier !== TRUST_TIER.SHIPPED) {
    throw new Error("reissue verify returned the stale tier");
  }
  console.log("    - reissued + verified at upgraded tier");

  console.log("8. Closing attestation...");
  await send(client, payer, [
    getCloseAttestationInstruction({
      payer,
      attestation: attestationPda,
      authority: signer,
      credential: credentialPda,
      eventAuthority,
      attestationProgram: SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
    }),
  ], "close");

  const afterClose = await fetchMaybeAttestation(client.rpc, attestationPda);
  if (afterClose.exists) throw new Error("attestation still exists after close");
  console.log("    - closed: attestation account gone");

  console.log("\nSAS devnet e2e completed.");
}

main().catch((error) => {
  console.error("e2e failed:", error);
  process.exit(1);
});
