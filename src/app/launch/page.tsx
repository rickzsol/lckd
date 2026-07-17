"use client";

import { Fragment, useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useLaunchWizard, STEP_LABELS, STEP_COUNT } from "@/hooks/useLaunchWizard";
import WalletButton from "@/components/ui/WalletButton";
import StepTokenDetails from "./StepTokenDetails";
import StepLockConfig from "./StepLockConfig";
import StepGitHub from "./StepGitHub";
import StepReview from "./StepReview";

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
      <div className="mx-auto max-w-[600px] px-4 pt-28 pb-16" role="status">
        <h1 className="font-sans text-3xl font-bold tracking-[-0.02em] text-text-1">Launch a token</h1>
        <p className="mt-3 font-mono text-sm text-text-3">Checking your session...</p>
      </div>
    );
  }

  if (status !== "authenticated") {
    return (
      <div className="mx-auto max-w-[600px] px-4 pt-28 pb-16">
        <h1 className="font-sans text-[clamp(28px,7vw,44px)] font-bold tracking-[-0.02em] text-text-1">
          Sign in before you build the launch
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-text-2">
          LCKD uses GitHub authentication for metadata uploads and transaction building.
          You will connect a Solana wallet separately when it is time to sign.
        </p>
        <div className="warning-box mt-6 leading-relaxed">
          The workflow requires two wallet approvals. The first creates a temporary address
          lookup table. The second atomically creates the token, executes the reviewed buy,
          deposits the lock into Streamflow, and deactivates the lookup table. Reclaiming its
          rent later requires one optional close approval after cooldown.
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
      <div className="mx-auto max-w-[600px] px-4 pt-28 pb-16" role="status">
        <h1 className="font-sans text-3xl font-bold tracking-[-0.02em] text-text-1">Launch a token</h1>
        <p className="mt-3 font-mono text-sm text-text-3">Checking wallet ownership...</p>
      </div>
    );
  }

  if (!linkedWallet) {
    return (
      <div className="mx-auto max-w-[600px] px-4 pt-28 pb-16">
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
      <div className="mx-auto max-w-[600px] px-4 pt-28 pb-16">
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

  return (
    <div className="mx-auto max-w-[600px] px-4 pt-28 pb-16">
      <h1 className="mb-1 font-sans text-[clamp(24px,6vw,32px)] font-bold tracking-[-0.02em] text-text-1">
        Launch a token
      </h1>
      <p className="mb-7 font-mono text-xs text-text-3">
        Create on pump.fun &middot; confirm &middot; lock separately with Streamflow
      </p>

      <div className="warning-box mb-6 leading-relaxed">
        Locking requires a second wallet signature. If token creation succeeds and the lock
        fails, the token remains created and the purchased tokens remain in your wallet until
        you retry the lock.
      </div>

      {/* Step indicator */}
      {wizard.launchStatus === "idle" && (
        <div className="mb-8 flex items-start">
          {STEP_LABELS.map((label, i) => {
            const num = i + 1;
            const isActive = num === wizard.step;
            const isComplete = num < wizard.step;
            const isFuture = num > wizard.step;

            return (
              <Fragment key={num}>
                {i > 0 && (
                  <div
                    className={`mt-4 h-px flex-1 transition-colors duration-[180ms] ${isComplete ? "bg-accent/60" : "bg-line-default"}`}
                  />
                )}
                <button
                  onClick={() => {
                    if (isComplete) wizard.goToStep(num);
                  }}
                    type="button"
                    className={`flex min-h-11 flex-col items-center justify-center gap-1.5 rounded-md px-1 ${isComplete ? "cursor-pointer" : "cursor-default"}`}
                  disabled={isFuture}
                  aria-current={isActive ? "step" : undefined}
                >
                  <div
                    className={`review-num h-8 w-8 rounded-full border-2 text-[11px] transition-all duration-[180ms] ${
                      isActive
                        ? "border-accent bg-accent text-accent-ink"
                        : isComplete
                          ? "border-accent bg-accent-dim text-accent"
                          : "border-line-default bg-transparent text-text-4"
                    }`}
                  >
                    {isComplete ? (
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      num
                    )}
                  </div>
                  <span
                    className={`whitespace-nowrap font-mono text-[10px] transition-colors duration-[180ms] ${
                      isActive
                        ? "text-accent"
                        : isComplete
                          ? "text-accent/50"
                          : "text-text-4"
                    }`}
                  >
                    {label}
                  </span>
                </button>
              </Fragment>
            );
          })}
        </div>
      )}

      {/* Progress bar (compact) */}
      {wizard.launchStatus === "idle" && (
        <div className="mb-6 flex gap-1">
          {Array.from({ length: STEP_COUNT }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                i + 1 <= wizard.step ? "bg-accent" : "bg-line-default"
              }`}
            />
          ))}
        </div>
      )}

      {/* Steps */}
      {wizard.step === 1 && <StepTokenDetails w={wizard} />}
      {wizard.step === 2 && <StepLockConfig w={wizard} />}
      {wizard.step === 3 && <StepGitHub w={wizard} />}
      {wizard.step === 4 && <StepReview w={wizard} />}
    </div>
  );
}
