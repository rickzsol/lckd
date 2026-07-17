"use client";

import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton,
    ),
  { ssr: false },
);

export default function WalletButton() {
  const { connected, publicKey } = useWallet();
  const isConnected = connected && publicKey != null;

  return (
    <WalletMultiButton>{isConnected ? undefined : "Connect Wallet"}</WalletMultiButton>
  );
}
