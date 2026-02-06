"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";

interface ClaimFeesResult {
  claimFees: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
  txSignature: string | null;
}

export function useClaimFees(): ClaimFeesResult {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const claimFees = useCallback(async () => {
    if (!publicKey || !signTransaction) {
      setError("Wallet not connected");
      return;
    }

    setIsLoading(true);
    setError(null);
    setTxSignature(null);

    try {
      const res = await fetch("https://pumpportal.fun/api/trade-local", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          publicKey: publicKey.toBase58(),
          action: "collectCreatorFee",
          priorityFee: "0.000001",
        }),
      });

      if (!res.ok) {
        throw new Error(`PumpPortal returned ${res.status}`);
      }

      const txBytes = new Uint8Array(await res.arrayBuffer());
      const tx = VersionedTransaction.deserialize(txBytes);
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      setTxSignature(sig);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to claim fees");
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, signTransaction, connection]);

  return { claimFees, isLoading, error, txSignature };
}
