"use client";

import { useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useLaunchWizard } from "@/hooks/useLaunchWizard";
import WalletButton from "@/components/ui/WalletButton";
import WizardPanel from "./WizardPanel";
import { isInAppBrowser } from "@/lib/inAppBrowser";

export default function LaunchPageClient({ callbackUrl }: { callbackUrl: "/launch" | "/launch-test" }) {
  const { data: session, status } = useSession();
  const { connected, publicKey } = useWallet();
  const [walletCheck, setWalletCheck] = useState<{
    username: string;
    walletAddress: string | null;
  } | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !session.identity_username) return;

    let isActive = true;
    const username = session.identity_username;
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
  }, [session?.identity_username, status]);

  const isWalletLinkLoading =
    status === "authenticated" &&
    walletCheck?.username !== session?.identity_username;
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
          Sign in with X or GitHub for metadata uploads and transaction building.
          You will connect a Solana wallet separately when it is time to sign.
        </p>
        <div className="warning-box mt-6">
          <span className="callout-title">two approvals</span>
          The first approval creates the address lookup table. The second atomically creates,
          buys, and completes the launch in one transaction.
        </div>
        {isInAppBrowser() && (
          <div className="warning-box mt-6">
            <span className="callout-title">in-app browser detected</span>
            OAuth sign-in can fail inside the X, Discord, and Instagram browsers. Open
            lckd.tech in Safari or Chrome to continue.
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={() => signIn("twitter", { callbackUrl })} className="btn-primary px-6">
            sign in with X
          </button>
          <button type="button" onClick={() => signIn("github", { callbackUrl })} className="btn-secondary px-6">
            sign in with GitHub
          </button>
        </div>
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
          href="/account"
          className="btn-primary mt-6 inline-flex px-6"
        >
          open account
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

  return <AuthenticatedWizard callbackUrl={callbackUrl} />;
}

function AuthenticatedWizard({ callbackUrl }: { callbackUrl: "/launch" | "/launch-test" }) {
  const wizard = useLaunchWizard();
  return <WizardPanel wizard={wizard} callbackUrl={callbackUrl} />;
}
