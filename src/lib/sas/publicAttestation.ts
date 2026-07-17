import "server-only";

import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";
import { loadSasConfig, SasConfigError } from "./config";
import { SAS_PROGRAM_ID } from "./verify";

/**
 * Public-facing attestation read for surfacing. Reads the RLS-scoped
 * attestations_public view (finalized + unexpired only) via the anon client,
 * never the base table. Returns null on any failure so a provider outage never
 * renders as a false "no attestation" or, worse, stale trust.
 */

export interface PublicAttestation {
  cluster: string;
  mint: string;
  tier: number;
  policyVersion: number;
  schemaVersion: number;
  attestationPda: string;
  expiryTs: string;
  txSignature: string | null;
}

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function getPublicAttestation(mint: string): Promise<PublicAttestation | null> {
  if (!SOLANA_ADDRESS.test(mint) || !hasSupabaseConfig()) return null;
  try {
    const { data, error } = await getSupabase()
      .from("attestations_public")
      .select("cluster, mint, tier, policy_version, schema_version, attestation_pda, expiry_ts, tx_signature")
      .eq("mint", mint)
      .order("generation", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as {
      cluster: string;
      mint: string;
      tier: number;
      policy_version: number;
      schema_version: number;
      attestation_pda: string;
      expiry_ts: string;
      tx_signature: string | null;
    };
    return {
      cluster: row.cluster,
      mint: row.mint,
      tier: row.tier,
      policyVersion: row.policy_version,
      schemaVersion: row.schema_version,
      attestationPda: row.attestation_pda,
      expiryTs: row.expiry_ts,
      txSignature: row.tx_signature,
    };
  } catch {
    return null;
  }
}

/** Explorer URL for an attestation account on the given cluster. */
export function attestationExplorerUrl(pda: string, cluster: string): string {
  const suffix = cluster === "devnet" ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/address/${pda}${suffix}`;
}

/**
 * The on-chain anchor descriptor for a token's finalized trust attestation: the
 * exact program id, credential PDA, schema PDA, attestation PDA, and expiry a
 * third party needs to verify the credential without trusting the LCKD API.
 *
 * This is the documented interface THIS branch (feature/sas-attestations)
 * provides to the trust API. The trust API's anchor response field is populated
 * from this descriptor. Every value here is public and safe to expose.
 */
export interface TrustAnchorDescriptor {
  /** SAS program id (identical on mainnet and devnet). */
  programId: string;
  /** LCKD's pinned credential PDA for the active cluster. */
  credentialPda: string;
  /** LCKD's pinned lckd-trust-v1 schema PDA for the active cluster. */
  schemaPda: string;
  /** The finalized attestation account PDA for this mint. */
  attestationPda: string;
  /** Cluster the attestation lives on. */
  cluster: string;
  /** Attestation expiry (equals the lock cliff), ISO 8601. */
  expiryTs: string;
  /** Schema version the attestation was issued under. */
  schemaVersion: number;
  /** Policy version embedded in the attestation payload. */
  policyVersion: number;
}

/**
 * Assemble the trust anchor descriptor for a mint from the finalized attestation
 * row plus the pinned SAS config. Returns null when there is no finalized
 * attestation or SAS is not configured, so a caller renders "no anchor" rather
 * than a partial descriptor.
 *
 * TODO(trust-api): the trust API (on feature/trust-api, not merged here) wires
 * this descriptor into its `anchor` response field. This branch owns the
 * descriptor's shape and derivation; the trust-api branch owns the endpoint that
 * returns it. Until that branch lands, this helper is the seam and is exercised
 * by publicAttestation tests, not yet by a production HTTP route.
 */
export async function getTrustAnchorDescriptor(mint: string): Promise<TrustAnchorDescriptor | null> {
  const attestation = await getPublicAttestation(mint);
  if (!attestation) return null;
  let config: ReturnType<typeof loadSasConfig>;
  try {
    config = loadSasConfig();
  } catch (error) {
    if (error instanceof SasConfigError) return null;
    throw error;
  }
  return {
    programId: SAS_PROGRAM_ID.toString(),
    credentialPda: config.credentialPda.toString(),
    schemaPda: config.schemaPda.toString(),
    attestationPda: attestation.attestationPda,
    cluster: attestation.cluster,
    expiryTs: attestation.expiryTs,
    schemaVersion: attestation.schemaVersion,
    policyVersion: attestation.policyVersion,
  };
}
