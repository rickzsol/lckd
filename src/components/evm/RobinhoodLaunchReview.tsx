"use client";

import { Check, CircleAlert, ExternalLink, LockKeyhole } from "lucide-react";
import { formatEther, parseEther, type Address } from "viem";
import {
  PONS_FACTORY_ADDRESS,
  PONS_GRADUATION_THRESHOLD_WEI,
  PONS_LAUNCH_FEE_WEI,
  PONS_LOCKER_ADDRESS,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL,
} from "@/lib/evm/pons";
import type { LaunchPhase, RobinhoodLaunchFormData } from "./launchTypes";

export type DeploymentState =
  | { status: "checking"; message: string }
  | { status: "ready"; message: string }
  | { status: "drift"; message: string };

interface Props {
  form: RobinhoodLaunchFormData;
  account?: Address;
  chainId?: number;
  deployment: DeploymentState;
  phase: LaunchPhase;
  mainnetEnabled: boolean;
  isRecoveryChecking: boolean;
  isRecoveryBlocked: boolean;
  actionError?: string;
  onConnect: () => void;
  onSwitchChain: () => void;
  onSubmit: () => void;
}

export default function RobinhoodLaunchReview(props: Props) {
  const { form, account, chainId, deployment, phase, mainnetEnabled, actionError } = props;
  const isWrongChain = Boolean(account && chainId !== ROBINHOOD_CHAIN_ID);
  const isBusy = ["simulating", "awaiting-wallet", "confirming"].includes(phase);
  const total = getTotal(form.initialBuyEth);

  let actionLabel = mainnetEnabled ? "simulate and launch" : "run launch simulation";
  if (phase === "simulating") actionLabel = "simulating contract call";
  if (phase === "recovery-checking") actionLabel = "checking launch recovery";
  if (phase === "prepared") actionLabel = "resume saved launch";
  if (phase === "awaiting-wallet") actionLabel = "confirm in wallet";
  if (phase === "confirming") actionLabel = "confirming on Robinhood";

  return (
    <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
      <section className="card overflow-hidden" aria-labelledby="review-heading">
        <div className="flex items-center justify-between border-b border-line-default px-5 py-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent">02 / Execution</p>
            <h2 id="review-heading" className="mt-1 text-xl font-semibold tracking-[-0.02em]">Launch review</h2>
          </div>
          <LockKeyhole className="h-5 w-5 text-accent" aria-hidden="true" />
        </div>

        <dl className="divide-y divide-line-default px-5 font-mono text-[11px]">
          <Row label="Fixed supply" value="1,000,000,000" />
          <Row label="Liquidity" value="Uniswap v3 · 1%" />
          <Row label="LP position" value="Permanent lock" accent />
          <Row label="LP fee split" value="70% creator · 30% protocol" />
          <Row label="Graduation indicator" value={`${formatEther(PONS_GRADUATION_THRESHOLD_WEI)} ETH`} />
          <Row label="Protocol launch fee" value={`${formatEther(PONS_LAUNCH_FEE_WEI)} ETH`} />
          <Row label="Initial buy" value={`${form.initialBuyEth || "0"} ETH`} />
          <Row label="Buy and fee recipient" value={shortAddress(form.feeWallet)} />
          <Row label="Total transaction value" value={`${total} ETH`} strong />
        </dl>

        <div className="space-y-3 border-t border-line-default p-5">
          {!account ? (
            <button type="button" onClick={props.onConnect} className="btn-secondary h-12 w-full">connect EVM wallet</button>
          ) : isWrongChain ? (
            <button type="button" onClick={props.onSwitchChain} className="btn-secondary h-12 w-full">switch to Robinhood Chain</button>
          ) : (
            <button type="button" onClick={props.onSubmit}
              disabled={isBusy || props.isRecoveryChecking || props.isRecoveryBlocked || deployment.status !== "ready"}
              className="btn-primary h-12 w-full">{actionLabel}</button>
          )}

          {!mainnetEnabled && (
            <p className="rounded-control border border-warn/20 bg-warn/5 px-3 py-2 font-mono text-[10px] leading-5 text-warn">
              Mainnet sending is disabled. This checks the live deployment and simulates the exact launch call without opening a wallet approval.
            </p>
          )}
          {actionError && <p role="alert" className="error-box leading-5">{actionError}</p>}
        </div>
      </section>

      <DeploymentCard state={deployment} />
      <p className="px-1 font-mono text-[10px] leading-5 text-text-4">
        GitHub authenticates a prepared intent only. The validated submitted transaction sender establishes EVM ownership. Recovery checkpoints persist, but public profile records are not yet active.
      </p>
    </aside>
  );
}

function DeploymentCard({ state }: { state: DeploymentState }) {
  const isReady = state.status === "ready";
  const isDrift = state.status === "drift";
  return (
    <section className={`rounded-card border p-4 ${isDrift ? "border-danger/30 bg-danger/5" : "border-line-default bg-surface-deep"}`}>
      <div className="flex items-start gap-3">
        {isReady ? <Check className="mt-0.5 h-4 w-4 text-accent" /> : <CircleAlert className={`mt-0.5 h-4 w-4 ${isDrift ? "text-danger" : "text-warn"}`} />}
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-text-2">
            {isReady ? "deployment verified" : isDrift ? "contract drift detected" : "checking deployment"}
          </p>
          <p className="mt-1 font-mono text-[10px] leading-5 text-text-3">{state.message}</p>
          <div className="mt-3 grid gap-1 font-mono text-[9px] text-text-4">
            <ContractLink label="Factory" address={PONS_FACTORY_ADDRESS} />
            <ContractLink label="LP locker" address={PONS_LOCKER_ADDRESS} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ label, value, accent, strong }: { label: string; value: string; accent?: boolean; strong?: boolean }) {
  return <div className="flex items-center justify-between gap-4 py-3"><dt className="text-text-3">{label}</dt><dd className={`${accent ? "text-accent" : strong ? "text-text-1" : "text-text-2"} text-right ${strong ? "font-bold" : ""}`}>{value}</dd></div>;
}

function ContractLink({ label, address }: { label: string; address: Address }) {
  return <a href={`${ROBINHOOD_EXPLORER_URL}/address/${address}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded px-1 py-0.5 hover:text-accent"><span>{label}</span><span className="flex items-center gap-1">{address.slice(0, 6)}...{address.slice(-4)}<ExternalLink className="h-2.5 w-2.5" /></span></a>;
}

function getTotal(initialBuyEth: string) {
  try {
    return formatEther(parseEther(initialBuyEth || "0") + PONS_LAUNCH_FEE_WEI);
  } catch {
    return formatEther(PONS_LAUNCH_FEE_WEI);
  }
}

function shortAddress(address: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "not set";
}
