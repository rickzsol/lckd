import "server-only";

import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

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
