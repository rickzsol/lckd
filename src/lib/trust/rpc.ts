import "server-only";
import { Connection } from "@solana/web3.js";

/** Finalized-commitment connection for lock verification. Mirrors the RPC
 * resolution used by the launch builders (server-only Helius URL in prod). */
export function getFinalizedConnection(): Connection {
  const rpcUrl = process.env.HELIUS_RPC_URL ?? (
    process.env.NODE_ENV === "production"
      ? undefined
      : process.env.NEXT_PUBLIC_HELIUS_RPC_URL
  );
  if (!rpcUrl) throw new Error("Lock verification RPC is unavailable");
  return new Connection(rpcUrl, "finalized");
}
