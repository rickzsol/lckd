import "server-only";

import {
  address,
  createSolanaClient,
  createKeyPairSignerFromBytes,
  type Address,
  type KeyPairSigner,
  type SolanaClient,
} from "gill";
import bs58 from "bs58";

/**
 * SAS adapter configuration boundary. Everything that touches gill/kit types,
 * cluster selection, and secret loading is confined here and in the issuer so
 * that no kit type leaks into the rest of the @solana/web3.js codebase.
 */

export type SasCluster = "devnet" | "mainnet";

export interface SasConfig {
  cluster: SasCluster;
  credentialPda: Address;
  schemaPda: Address;
}

export class SasConfigError extends Error {}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new SasConfigError(`Missing required env ${name}`);
  return value;
}

/** Whether SAS issuance is enabled. Defaults off so nothing issues by accident. */
export function isSasEnabled(): boolean {
  return process.env.SAS_ENABLED === "true";
}

/** Public config: cluster + pinned PDAs. Safe to expose the PDAs publicly. */
export function loadSasConfig(): SasConfig {
  const clusterRaw = requireEnv("SAS_CLUSTER");
  if (clusterRaw !== "devnet" && clusterRaw !== "mainnet") {
    throw new SasConfigError("SAS_CLUSTER must be 'devnet' or 'mainnet'");
  }
  return {
    cluster: clusterRaw,
    credentialPda: address(requireEnv("SAS_CREDENTIAL_PDA")),
    schemaPda: address(requireEnv("SAS_SCHEMA_PDA")),
  };
}

/**
 * Resolve the RPC url. Prefers the repo's Helius RPC (private, high limits) and
 * falls back to public monikers only on devnet, never in production.
 */
function resolveRpcUrl(cluster: SasCluster): string {
  const heliusUrl = process.env.HELIUS_RPC_URL?.trim();
  if (heliusUrl) return heliusUrl;
  if (cluster === "mainnet") {
    throw new SasConfigError("HELIUS_RPC_URL is required for mainnet SAS");
  }
  return "devnet";
}

export function createSasClient(cluster: SasCluster): SolanaClient {
  return createSolanaClient({ urlOrMoniker: resolveRpcUrl(cluster) });
}

/**
 * Decode a signer secret from env. Accepts either a base58-encoded 64-byte
 * secret key or a JSON array of 64 bytes (Solana CLI keypair format). Never
 * logs the material. Prefer a KMS/remote signer in production; this env-based
 * path is the minimum viable custody.
 */
async function loadSignerFromSecret(secret: string): Promise<KeyPairSigner> {
  const trimmed = secret.trim();
  let bytes: Uint8Array;
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as number[];
    if (!Array.isArray(parsed) || parsed.length !== 64) {
      throw new SasConfigError("Signer secret JSON must be 64 bytes");
    }
    bytes = Uint8Array.from(parsed);
  } else {
    bytes = bs58.decode(trimmed);
    if (bytes.length !== 64) {
      throw new SasConfigError("Signer secret must decode to 64 bytes");
    }
  }
  return createKeyPairSignerFromBytes(bytes);
}

/** The authorized hot signer that signs create/close attestation instructions. */
export function loadSignerSigner(): Promise<KeyPairSigner> {
  return loadSignerFromSecret(requireEnv("SAS_SIGNER_SECRET"));
}

/** The separate fee payer keypair funding rent and network fees. */
export function loadFeePayerSigner(): Promise<KeyPairSigner> {
  return loadSignerFromSecret(requireEnv("SAS_FEE_PAYER_SECRET"));
}
