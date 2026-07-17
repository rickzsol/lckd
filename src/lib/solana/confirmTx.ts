import type { Commitment, Connection } from "@solana/web3.js";

/**
 * Confirms a transaction using blockhash-based strategy (reliable) with a
 * fallback signature status poll. The deprecated 2-arg confirmTransaction
 * relies on WebSocket which drops silently on many RPC providers.
 */
export async function confirmTxReliably(
  connection: Connection,
  signature: string,
  blockhash: string,
  lastValidBlockHeight: number,
  commitment: Commitment = "confirmed",
): Promise<void> {
  try {
    const result = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      commitment,
    );
    if (result.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
    }
    return;
  } catch (err) {
    // Blockhash-based confirmation can throw if the blockhash expires.
    // Fall back to polling getSignatureStatuses (up to ~60s).
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const statusRes = await connection.getSignatureStatuses([signature]);
      const status = statusRes.value[0];
      if (status) {
        if (status.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
        }
        if (
          status.confirmationStatus === "finalized" ||
          (commitment !== "finalized" && status.confirmationStatus === "confirmed")
        ) {
          return;
        }
      }
    }
    throw err;
  }
}
