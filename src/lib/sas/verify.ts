import {
  fetchMaybeAttestation,
  fetchMaybeSchema,
  deriveAttestationPda,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
  type Attestation,
} from "sas-lib";
import { address, type Address, type Rpc, type SolanaRpcApi } from "gill";

import {
  SCHEMA_LAYOUT,
  SCHEMA_VERSION,
  deserializeTrustData,
  type TrustAttestationData,
} from "./schema";

/**
 * Third-party verification of an LCKD trust attestation.
 *
 * Schema and credential NAMES are not trust anchors: anyone can create a
 * lookalike. A verifier must pin the SAS program id, LCKD's exact credential
 * PDA, the exact schema PDA and version, and the serialized layout, then check
 * expiry and that the payload's mint matches the token being evaluated.
 *
 * This is the reference implementation surfaced verbatim on /api-docs so that
 * anyone can verify a tier without trusting LCKD's own API.
 */

/** SAS program id, identical on mainnet and devnet. */
export const SAS_PROGRAM_ID = SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS;

export interface PinnedAnchors {
  /** LCKD's exact credential PDA for the target cluster. */
  credentialPda: Address;
  /** LCKD's exact lckd-trust-v1 schema PDA for the target cluster. */
  schemaPda: Address;
}

export type VerifyRejection =
  | "attestation_not_found"
  | "schema_not_found"
  | "wrong_program"
  | "wrong_credential"
  | "wrong_schema"
  | "wrong_schema_version"
  | "wrong_layout"
  | "expired"
  | "mint_mismatch"
  | "malformed_payload";

export type VerifyResult =
  | { verified: true; data: TrustAttestationData; attestationPda: Address; expiry: bigint }
  | { verified: false; reason: VerifyRejection };

function layoutMatches(onChain: { readonly length: number; readonly [index: number]: number }): boolean {
  const expected = SCHEMA_LAYOUT;
  if (onChain.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (onChain[i] !== expected[i]) return false;
  }
  return true;
}

function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

/**
 * Verify a trust attestation for a given mint against pinned anchors.
 * Returns a discriminated result so callers can branch on the exact rejection.
 */
export async function verifyTrustAttestation(
  rpc: Rpc<SolanaRpcApi>,
  anchors: PinnedAnchors,
  mint: string,
): Promise<VerifyResult> {
  const mintAddress = address(mint);

  // Pin the schema account: it must exist, be unpaused, carry the version we
  // trust, sit under our credential, and match the exact serialized layout.
  const schema = await fetchMaybeSchema(rpc, anchors.schemaPda);
  if (!schema.exists) return { verified: false, reason: "schema_not_found" };
  if (schema.programAddress !== SAS_PROGRAM_ID) {
    return { verified: false, reason: "wrong_program" };
  }
  if (schema.data.credential !== anchors.credentialPda) {
    return { verified: false, reason: "wrong_credential" };
  }
  if (schema.data.version !== SCHEMA_VERSION) {
    return { verified: false, reason: "wrong_schema_version" };
  }
  if (!layoutMatches(schema.data.layout)) {
    return { verified: false, reason: "wrong_layout" };
  }

  // Derive the attestation PDA from the pinned anchors + mint nonce. Anyone can
  // reproduce this derivation; the derived address cannot be spoofed.
  const [attestationPda] = await deriveAttestationPda({
    credential: anchors.credentialPda,
    schema: anchors.schemaPda,
    nonce: mintAddress,
  });

  const attestation = await fetchMaybeAttestation(rpc, attestationPda);
  if (!attestation.exists) return { verified: false, reason: "attestation_not_found" };
  if (attestation.programAddress !== SAS_PROGRAM_ID) {
    return { verified: false, reason: "wrong_program" };
  }

  const account: Attestation = attestation.data;
  if (account.credential !== anchors.credentialPda) {
    return { verified: false, reason: "wrong_credential" };
  }
  if (account.schema !== anchors.schemaPda) {
    return { verified: false, reason: "wrong_schema" };
  }
  if (account.nonce !== mintAddress) {
    return { verified: false, reason: "mint_mismatch" };
  }
  if (nowSeconds() >= account.expiry) {
    return { verified: false, reason: "expired" };
  }

  let data: TrustAttestationData;
  try {
    data = deserializeTrustData(account.data as Uint8Array);
  } catch {
    return { verified: false, reason: "malformed_payload" };
  }
  if (data.mint !== mint) {
    return { verified: false, reason: "mint_mismatch" };
  }

  return { verified: true, data, attestationPda, expiry: account.expiry };
}
