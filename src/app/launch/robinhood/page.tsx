"use client";

import { useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { ArrowUpRight, Network, ShieldCheck } from "lucide-react";
import { useAccount, useConnect, useSwitchChain } from "wagmi";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_EXPLORER_URL } from "@/lib/evm/pons";
import RobinhoodLaunchForm from "@/components/evm/RobinhoodLaunchForm";
import RobinhoodLaunchReview from "@/components/evm/RobinhoodLaunchReview";
import RobinhoodLaunchStatus from "@/components/evm/RobinhoodLaunchStatus";
import { INITIAL_FORM } from "@/components/evm/launchTypes";
import { usePonsLaunch } from "@/components/evm/usePonsLaunch";

export default function RobinhoodLaunchPage() {
  const { data: session, status } = useSession();
  const { address, chainId } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const [form, setForm] = useState(INITIAL_FORM);
  const [walletError, setWalletError] = useState<string>();
  const launch = usePonsLaunch(address);

  if (status === "loading") return <SessionState title="Checking your session" detail="Loading account authentication..." />;
  if (status !== "authenticated") {
    return (
      <SessionState title="Authenticate the launch session" detail="X or GitHub identifies the builder account. Your EVM wallet connects separately and remains the only transaction signer.">
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={() => signIn("twitter", { callbackUrl: "/launch/robinhood" })} className="btn-primary px-6">sign in with X</button>
          <button type="button" onClick={() => signIn("github", { callbackUrl: "/launch/robinhood" })} className="btn-secondary px-6">sign in with GitHub</button>
        </div>
      </SessionState>
    );
  }

  const connectWallet = async () => {
    setWalletError(undefined);
    const connector = connectors[0];
    if (!connector) {
      setWalletError("No injected EVM wallet was found. Install or enable a browser wallet.");
      return;
    }
    try {
      await connectAsync({ connector, chainId: ROBINHOOD_CHAIN_ID });
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Wallet connection failed.");
    }
  };

  const switchNetwork = async () => {
    setWalletError(undefined);
    try {
      await switchChainAsync({ chainId: ROBINHOOD_CHAIN_ID });
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Network switch failed.");
    }
  };

  const isFormDisabled = launch.isRecoveryChecking || launch.isRecoveryBlocked
    || ["simulating", "awaiting-wallet", "confirming"].includes(launch.phase)
    || Boolean(launch.recovery);
  const draftForm = form.feeWallet || !address ? form : { ...form, feeWallet: address };
  const effectiveForm = launch.recoveryForm ?? draftForm;
  const launchAnother = () => {
    launch.resetTerminal();
    setForm(INITIAL_FORM);
  };

  return (
    <div className="relative min-h-[calc(100vh-80px)] overflow-hidden px-4 pb-20 pt-24 sm:px-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-30"
        style={{ backgroundImage: "linear-gradient(rgba(43,209,126,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(43,209,126,.035) 1px,transparent 1px)", backgroundSize: "48px 48px", maskImage: "linear-gradient(to bottom,black,transparent 72%)" }} />
      <div className="relative mx-auto max-w-[1080px]">
        <header className="mb-8 grid gap-6 border-b border-line-default pb-7 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em]">
              <span className="rounded-full border border-accent/25 bg-accent-dim px-3 py-1.5 text-accent">Robinhood Chain · mainnet</span>
              <span className="rounded-full border border-line-default px-3 py-1.5 text-text-3">Pons launch rail</span>
            </div>
            <h1 className="max-w-3xl text-[clamp(34px,7vw,64px)] font-bold leading-[0.98] tracking-[-0.055em] text-text-1">
              Liquidity enters.<br /><span className="text-accent">The lock does not leave.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-text-2">
              Create a fixed-supply token, open one-sided Uniswap v3 liquidity, and permanently transfer the LP position to the Pons locker in one transaction.
            </p>
          </div>
          <div className="grid min-w-[230px] grid-cols-2 gap-px overflow-hidden rounded-card border border-line-default bg-line-default font-mono text-[10px]">
            <HeaderStat icon={<Network />} label="Chain ID" value={String(ROBINHOOD_CHAIN_ID)} />
            <HeaderStat icon={<ShieldCheck />} label="Session" value={`@${session.identity_username}`} />
          </div>
        </header>

        {address && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-control border border-line-default bg-surface-deep px-4 py-2.5 font-mono text-[10px] text-text-3">
            <span>Connected signer · {address.slice(0, 8)}...{address.slice(-6)}</span>
            <a href={`${ROBINHOOD_EXPLORER_URL}/address/${address}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent hover:text-accent-300">view account <ArrowUpRight className="h-3 w-3" /></a>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)]">
          <div>
            <RobinhoodLaunchForm value={effectiveForm} errors={launch.errors} isDisabled={isFormDisabled} onChange={setForm} />
            <RobinhoodLaunchStatus phase={launch.phase} result={launch.result}
              recovery={launch.recovery} pendingTransactionHash={launch.pendingTransactionHash}
              isRecoveryChecking={launch.isRecoveryChecking} onRetryRecovery={launch.retryRecovery}
              onLaunchAnother={launchAnother} />
          </div>
          <RobinhoodLaunchReview form={effectiveForm} account={address} chainId={chainId}
            deployment={launch.deployment} phase={launch.phase} mainnetEnabled={launch.mainnetEnabled}
            isRecoveryChecking={launch.isRecoveryChecking}
            isRecoveryBlocked={launch.isRecoveryBlocked || launch.recovery?.status === "verified" || launch.recovery?.status === "failed"}
            actionError={walletError ?? launch.actionError} onConnect={connectWallet}
            onSwitchChain={switchNetwork} onSubmit={() => launch.submit(effectiveForm)} />
        </div>
      </div>
    </div>
  );
}

function HeaderStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="bg-surface-deep p-3"><span className="flex items-center gap-1.5 text-text-4">{icon}{label}</span><span className="mt-2 block truncate font-bold text-text-2">{value}</span></div>;
}

function SessionState({ title, detail, children }: { title: string; detail: string; children?: React.ReactNode }) {
  return <div className="mx-auto min-h-[70vh] max-w-[640px] px-4 pb-20 pt-32"><p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent">Robinhood Chain · Pons</p><h1 className="mt-3 text-[clamp(32px,7vw,52px)] font-bold leading-tight tracking-[-0.04em]">{title}</h1><p className="mt-4 max-w-xl text-base leading-7 text-text-2">{detail}</p>{children}</div>;
}
