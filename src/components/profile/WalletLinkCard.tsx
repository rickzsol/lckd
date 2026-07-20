"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

interface Props {
  provider: "github" | "twitter";
  username: string;
  initialWalletAddress: string | null;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export default function WalletLinkCard({ provider, username, initialWalletAddress }: Props) {
  const { publicKey, signMessage, connected } = useWallet();
  const [isLinking, setIsLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState(initialWalletAddress);

  const handleLinkWallet = useCallback(async () => {
    if (!publicKey || !signMessage) return;
    setIsLinking(true);
    setError(null);

    try {
      const timestamp = Date.now();
      const message = [
        "Link wallet to lckd.tech",
        `Provider: ${provider}`,
        `Username: ${username}`,
        `Timestamp: ${timestamp}`,
      ].join("\n");
      const signatureBytes = await signMessage(new TextEncoder().encode(message));
      const signature = btoa(String.fromCharCode(...signatureBytes));
      const response = await fetch("/api/profile/link-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          signature,
          message,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to link wallet");
      setWalletAddress(publicKey.toBase58());
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Failed to link wallet");
    } finally {
      setIsLinking(false);
    }
  }, [provider, publicKey, signMessage, username]);

  return (
    <div className="rounded-card border border-line-default bg-surface p-5">
      <h2 className="font-sans text-base font-bold text-text-1">Verified wallet</h2>
      <p className="mt-2 font-mono text-[11px] leading-5 text-text-3">
        Link the Solana wallet that will approve and own your launches.
      </p>
      {walletAddress ? (
        <p className="mt-4 font-mono text-sm font-semibold text-accent">
          {truncateAddress(walletAddress)} linked
        </p>
      ) : connected && publicKey ? (
        <button
          type="button"
          onClick={handleLinkWallet}
          disabled={isLinking}
          className="btn-primary mt-4 px-5"
        >
          {isLinking ? "waiting for signature..." : "link connected wallet"}
        </button>
      ) : (
        <p className="mt-4 font-mono text-[11px] text-text-3">
          Connect a wallet from the navigation bar first.
        </p>
      )}
      {error && <p role="alert" className="mt-3 font-mono text-[11px] text-danger">{error}</p>}
    </div>
  );
}
