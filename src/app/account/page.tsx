"use client";

import { useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import WalletLinkCard from "@/components/profile/WalletLinkCard";

export default function AccountPage() {
  const { data: session, status } = useSession();
  const [walletAddress, setWalletAddress] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/profile/link-wallet")
      .then(async (response) => response.status === 403 ? null : (await response.json()).walletAddress)
      .then((address) => setWalletAddress(typeof address === "string" ? address : null))
      .catch(() => setWalletAddress(null));
  }, [status]);

  if (status === "loading" || (status === "authenticated" && walletAddress === undefined)) {
    return <main className="mx-auto max-w-[620px] px-4 pt-28 font-mono text-sm text-text-3">Loading account...</main>;
  }
  if (!session) {
    return (
      <main className="mx-auto max-w-[620px] px-4 pt-28">
        <h1 className="font-sans text-3xl font-bold text-text-1">Sign in to manage your account</h1>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={() => signIn("twitter", { callbackUrl: "/account" })} className="btn-primary px-5">sign in with X</button>
          <button type="button" onClick={() => signIn("github", { callbackUrl: "/account" })} className="btn-secondary px-5">sign in with GitHub</button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[620px] px-4 pt-28 pb-16">
      <p className="font-mono text-[11px] uppercase tracking-wider text-accent">{session.identity_provider} account</p>
      <h1 className="mt-2 font-sans text-3xl font-bold text-text-1">@{session.identity_username}</h1>
      <div className="mt-6">
        <WalletLinkCard
          provider={session.identity_provider}
          username={session.identity_username}
          initialWalletAddress={walletAddress ?? null}
        />
      </div>
    </main>
  );
}
