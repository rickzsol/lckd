"use client";

import { useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useLaunchWizard } from "@/hooks/useLaunchWizard";
import WalletButton from "@/components/ui/WalletButton";
import WizardPanel from "./WizardPanel";

export default function LaunchPage() {
  const wizard = useLaunchWizard();
  const { data: session, status } = useSession();
  const { connected, publicKey } = useWallet();
  const [walletCheck, setWalletCheck] = useState<{
    username: string;
    walletAddress: string | null;
  } | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !session.github_username) return;

    let isActive = true;
    const username = session.github_username;
    fetch("/api/profile/link-wallet")
      .then(async (response) => {
        if (response.status === 403) return null;
        if (!response.ok) throw new Error("Unable to verify linked wallet");
        const body = await response.json();
        return typeof body.walletAddress === "string" ? body.walletAddress : null;
      })
      .then((walletAddress) => {
        if (isActive) setWalletCheck({ username, walletAddress });
      })
      .catch(() => {
        if (isActive) setWalletCheck({ username, walletAddress: null });
      });

    return () => {
      isActive = false;
    };
  }, [session?.github_username, status]);

  const isWalletLinkLoading =
    status === "authenticated" &&
    walletCheck?.username !== session?.github_username;
  const linkedWallet = isWalletLinkLoading ? null : walletCheck?.walletAddress ?? null;

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-[680px] px-4 pt-28 pb-16 sm:px-6" role="status">
        <h1 className="font-sans text-3xl font-bold tracking-[-0.02em] text-text-1">Launch a token</h1>
        <p className="mt-3 font-mono text-sm text-text-3">Checking your session...</p>
      </div>
    );
  }

  if (status !== "authenticated") {
    return (
      <div className="mx-auto max-w-[680px] px-4 pt-28 pb-16 sm:px-6">
        <h1 className="font-sans text-[clamp(28px,7vw,44px)] font-bold tracking-[-0.02em] text-text-1">
          Sign in before you build the launch
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-text-2">
          LCKD uses GitHub authentication for metadata uploads and transaction building.
          You will connect a Solana wallet separately when it is time to sign.
        </p>
        <div className="warning-box mt-6">
          <span className="callout-title">two transactions</span>
          The workflow requires two transactions. The create and buy transaction confirms
          first. The Streamflow time lock requires a second approval and can fail independently.
        </div>
        <button
          type="button"
          onClick={() => signIn("github", { callbackUrl: "/launch" })}
          className="btn-primary mt-6 px-6"
        >
          sign in with github
        </button>
      </div>
    );
  }

  if (isWalletLinkLoading) {
    return (
      <div className="mx-auto max-w-[680px] px-4 pt-28 pb-16 sm:px-6" role="status">
        <h1 className="font-sans text-3xl font-bold tracking-[-0.02em] text-text-1">Launch a token</h1>
        <p className="mt-3 font-mono text-sm text-text-3">Checking wallet ownership...</p>
      </div>
    );
  }

  if (!linkedWallet) {
    return (
      <div className="mx-auto max-w-[680px] px-4 pt-28 pb-16 sm:px-6">
        <h1 className="font-sans text-[clamp(28px,7vw,44px)] font-bold tracking-[-0.02em] text-text-1">
          Link a wallet before launching
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-text-2">
          Sign a wallet ownership message from your developer profile before any launch
          transaction is built or signed.
        </p>
        <Link
          href={`/dev/${session?.github_username ?? ""}`}
          className="btn-primary mt-6 inline-flex px-6"
        >
          open developer profile
        </Link>
      </div>
    );
  }

  if (!connected || !publicKey || publicKey.toBase58() !== linkedWallet) {
    return (
      <div className="mx-auto max-w-[680px] px-4 pt-28 pb-16 sm:px-6">
        <h1 className="font-sans text-[clamp(28px,7vw,44px)] font-bold tracking-[-0.02em] text-text-1">
          Connect your verified wallet
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-text-2">
          This launch is authorized for {linkedWallet.slice(0, 4)}...{linkedWallet.slice(-4)}.
          Connect that wallet before continuing.
        </p>
        <div className="mt-6">
          <WalletButton />
        </div>
      </div>
    );
  }

  return <WizardPanel wizard={wizard} />;
}
