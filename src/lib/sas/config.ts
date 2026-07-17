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
 * Genesis hashes pin an RPC to a cluster. A mismatch means the configured RPC
 * serves a different chain than SAS_CLUSTER claims, so we refuse to sign against
 * it. Values are the canonical Solana cluster genesis hashes.
 */
const GENESIS_HASH: Record<SasCluster, string> = {
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
};

/**
 * Resolve the RPC url for a cluster. Each cluster reads its OWN variable so a
 * single shared URL can never point devnet issuance at mainnet:
 *   mainnet -> SAS_MAINNET_RPC_URL (required)
 *   devnet  -> SAS_DEVNET_RPC_URL, else the public devnet moniker
 * HELIUS_RPC_URL is accepted only as a legacy fallback for the ACTIVE cluster
 * and is validated by the genesis-hash check before any signing.
 */
function resolveRpcUrl(cluster: SasCluster): string {
  if (cluster === "mainnet") {
    const url = process.env.SAS_MAINNET_RPC_URL?.trim() || process.env.HELIUS_RPC_URL?.trim();
    if (!url) throw new SasConfigError("SAS_MAINNET_RPC_URL is required for mainnet SAS");
    return url;
  }
  const devUrl = process.env.SAS_DEVNET_RPC_URL?.trim();
  if (devUrl) return devUrl;
  const legacy = process.env.HELIUS_RPC_URL?.trim();
  if (legacy && legacy.includes("devnet")) return legacy;
  return "devnet";
}

export function createSasClient(cluster: SasCluster): SolanaClient {
  return createSolanaClient({ urlOrMoniker: resolveRpcUrl(cluster) });
}

/**
 * Verify the RPC actually serves the cluster it is configured for. Called before
 * any signing so a misconfigured RPC can never persist a false cluster label or
 * issue against the wrong chain. Throws SasConfigError on a mismatch.
 */
export async function assertRpcMatchesCluster(
  client: SolanaClient,
  cluster: SasCluster,
): Promise<void> {
  const genesis = await client.rpc.getGenesisHash().send();
  const expected = GENESIS_HASH[cluster];
  if (genesis !== expected) {
    throw new SasConfigError(
      `RPC genesis hash ${genesis} does not match SAS_CLUSTER=${cluster} (${expected})`,
    );
  }
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
