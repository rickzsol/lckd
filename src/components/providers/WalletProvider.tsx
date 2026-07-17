"use client";

import { useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import {
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
  registerMwa,
} from "@solana-mobile/wallet-standard-mobile";

import "@solana/wallet-adapter-react-ui/styles.css";

const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

function inferMwaChain(endpoint: string): `solana:${string}` {
  const lowered = endpoint.toLowerCase();
  if (lowered.includes("devnet")) return "solana:devnet";
  if (lowered.includes("testnet")) return "solana:testnet";
  return "solana:mainnet";
}

// Registers Mobile Wallet Adapter as a wallet option on Android Chrome.
// Must run in the browser only; module scope of a client component still
// executes during SSR.
if (typeof window !== "undefined") {
  registerMwa({
    appIdentity: {
      name: "LCKD",
      uri: `${window.location.protocol}//${window.location.host}`,
      icon: "icon.png",
    },
    authorizationCache: createDefaultAuthorizationCache(),
    chains: [inferMwaChain(RPC_ENDPOINT)],
    chainSelector: createDefaultChainSelector(),
    onWalletNotFound: createDefaultWalletNotFoundHandler(),
  });
}

export default function WalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider
      endpoint={RPC_ENDPOINT}
      config={{ commitment: "confirmed" }}
    >
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
