"use client";

import { CheckCircle2, ExternalLink, LoaderCircle } from "lucide-react";
import { ROBINHOOD_EXPLORER_URL } from "@/lib/evm/pons";
import type { Address, Hash } from "viem";
import type { LaunchPhase } from "./launchTypes";
import type { RobinhoodRecoveryIntent } from "./robinhoodRecovery";

export interface VerifiedLaunchDisplay {
  transactionHash: Hash;
  tokenAddress: Address;
  poolAddress?: Address;
}

export default function RobinhoodLaunchStatus({
  phase,
  result,
  recovery,
  pendingTransactionHash,
  isRecoveryChecking,
  onRetryRecovery,
  onLaunchAnother,
}: {
  phase: LaunchPhase;
  result?: VerifiedLaunchDisplay;
  recovery?: RobinhoodRecoveryIntent;
  pendingTransactionHash?: Hash;
  isRecoveryChecking: boolean;
  onRetryRecovery: () => void;
  onLaunchAnother: () => void;
}) {
  if (phase === "idle") return null;

  if (phase === "error" && recovery?.status === "failed") {
    return (
      <div role="alert" className="error-box mt-5 p-4 leading-5">
        <strong className="block">Recovered launch failed</strong>
        <span className="block">{recovery.error ?? "The submitted transaction did not complete successfully."}</span>
        <button type="button" onClick={onLaunchAnother} className="btn-secondary mt-3">launch another</button>
      </div>
    );
  }
  if (phase === "error" && recovery
    && (recovery.status === "prepared" || recovery.status === "submitted" || recovery.status === "ambiguous")) {
    return (
      <div role="alert" className="error-box mt-5 p-4 leading-5">
        <strong className="block">Active launch recovery is blocked</strong>
        <span className="block">This exact {recovery.status} intent remains locked. Local hashes are candidates only. The server must validate the transaction sender and calldata before binding it.</span>
        {pendingTransactionHash && (
          <a href={`${ROBINHOOD_EXPLORER_URL}/tx/${pendingTransactionHash}`} target="_blank" rel="noreferrer"
            className="mt-3 flex items-center gap-1 text-accent hover:text-accent-300">
            view submitted transaction <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {recovery.status === "ambiguous" && (
          <button type="button" onClick={onRetryRecovery} disabled={isRecoveryChecking}
            className="btn-secondary mt-3 disabled:cursor-not-allowed disabled:opacity-50">
            {isRecoveryChecking ? "checking recovery" : "retry recovery"}
          </button>
        )}
      </div>
    );
  }
  if (phase === "error") return null;

  if (phase === "simulated") {
    return (
      <div role="status" className="callout-success mt-5 flex items-start gap-3 p-4 leading-5">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Simulation passed against the live Pons factory. No transaction was sent.</span>
      </div>
    );
  }

  if (phase === "prepared" && recovery) {
    return (
      <div role="status" className="warning-box mt-5 flex items-start gap-3 p-4 leading-5">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          <strong className="block">Prepared launch restored</strong>
          The exact form and salt ending {recovery.salt.slice(-8)} are locked. GitHub prepared this intent, but EVM ownership is established only by the validated transaction sender.
        </span>
      </div>
    );
  }

  if (phase === "verified" && result) {
    return (
      <section role="status" aria-labelledby="verified-heading" className="mt-5 overflow-hidden rounded-card border border-accent/30 bg-accent-dim">
        <div className="flex items-start gap-3 border-b border-accent/15 p-5">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-accent">post-verified onchain</p>
            <h2 id="verified-heading" className="mt-1 text-xl font-semibold text-text-1">Launch and permanent LP lock verified</h2>
            <p className="mt-2 font-mono text-[10px] leading-5 text-text-3">The token launch event, factory provenance, and locker ownership were checked after confirmation.</p>
          </div>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-3">
          <ExplorerLink label="token" href={`${ROBINHOOD_EXPLORER_URL}/address/${result.tokenAddress}`} />
          <ExplorerLink label="transaction" href={`${ROBINHOOD_EXPLORER_URL}/tx/${result.transactionHash}`} />
          {result.poolAddress && <ExplorerLink label="pool" href={`${ROBINHOOD_EXPLORER_URL}/address/${result.poolAddress}`} />}
        </div>
        {recovery?.status === "verified" && (
          <div className="border-t border-accent/15 p-4">
            <button type="button" onClick={onLaunchAnother} className="btn-secondary w-full">launch another</button>
          </div>
        )}
      </section>
    );
  }

  const message = phase === "recovery-checking"
    ? "Checking this wallet for durable launch recovery..."
    : phase === "simulating"
    ? "Simulating the exact payable contract call..."
    : phase === "awaiting-wallet"
      ? "Review the factory address and value in your wallet."
      : "Transaction submitted. Waiting for confirmation and post-verification...";

  return (
    <div role="status" aria-live="polite" className="mt-5 rounded-control border border-line-default bg-surface px-4 py-3 font-mono text-[11px] text-text-2">
      <span className="flex items-center gap-3">
        <LoaderCircle className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
        {message}
      </span>
      {pendingTransactionHash && (
        <a href={`${ROBINHOOD_EXPLORER_URL}/tx/${pendingTransactionHash}`} target="_blank" rel="noreferrer"
          className="mt-3 flex items-center justify-between gap-3 border-t border-line-default pt-3 text-accent hover:text-accent-300">
          <span>Transaction {pendingTransactionHash.slice(0, 10)}...{pendingTransactionHash.slice(-6)}</span>
          <span className="flex items-center gap-1">view pending <ExternalLink className="h-3 w-3" /></span>
        </a>
      )}
    </div>
  );
}

function ExplorerLink({ label, href }: { label: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-control border border-accent/20 bg-bg/50 px-3 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-accent transition-colors hover:border-accent/50 hover:bg-accent-dim">
      {label}<ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}
