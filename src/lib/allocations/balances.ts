import "server-only";

import { Connection, PublicKey } from "@solana/web3.js";

let connection: Connection | null = null;

export class BalanceReadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function getReadConnection(): Connection {
  const rpcUrl = process.env.HELIUS_RPC_URL ?? (
    process.env.NODE_ENV === "production"
      ? undefined
      : process.env.NEXT_PUBLIC_HELIUS_RPC_URL
  );
  if (!rpcUrl) {
    throw new BalanceReadError("Balance reads are unavailable", 503);
  }
  if (!connection) {
    connection = new Connection(rpcUrl, { commitment: "confirmed" });
  }
  return connection;
}

/** Sum of an owner's token accounts for one mint, in raw base units. */
export async function getOwnerMintBalance(
  owner: string,
  mint: string,
): Promise<bigint> {
  const rpc = getReadConnection();
  const ownerKey = new PublicKey(owner);
  const mintKey = new PublicKey(mint);

  // The mint filter covers both token programs; the RPC resolves the
  // owning program from the mint itself.
  const { value } = await rpc.getParsedTokenAccountsByOwner(
    ownerKey,
    { mint: mintKey },
    "confirmed",
  );
  let total = BigInt(0);
  for (const account of value) {
    const amount = account.account.data.parsed?.info?.tokenAmount?.amount;
    if (typeof amount === "string" && /^\d+$/.test(amount)) {
      total += BigInt(amount);
    }
  }
  return total;
}
