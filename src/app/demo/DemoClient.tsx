"use client";

import { useMemo, useState } from "react";
import OfficialTokenClient from "@/app/token/lckd/OfficialTokenClient";
import TokenDetailClient from "@/app/token/[id]/TokenDetailClient";
import WizardPanel from "@/app/launch/WizardPanel";
import {
  LAUNCH_PHASES_WITH_LOCK,
  type LaunchResult,
  type LaunchStatus,
  type WizardContext,
} from "@/hooks/useLaunchWizard";
import { DemoGitHubContext, type DemoGitHubData } from "@/app/launch/githubProof";
import type { OfficialLaunchEvent } from "@/lib/launchMonitor";
import type { DisplayToken } from "@/types/display";
import { type LaunchConfig, TrustTier } from "@/types/index";

const DEMO_MINT = "6weTzoLKhoYGChmkhotrJhNKwZdB8TWBG7XG3qmGpump";
const DEMO_SIG = "5DemoSignatureNotRealxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const UNLOCK_AT = "2026-10-15T18:00:00.000Z";
const DETECTED_AT = "2026-07-17T12:00:00.000Z";

const DEMO_LAUNCH: OfficialLaunchEvent = {
  detectedAt: DETECTED_AT,
  metadataUri: "",
  mintAddress: DEMO_MINT,
  name: "LCKD",
  symbol: "LCKD",
  signature: DEMO_SIG,
  slot: 0,
  status: "confirmed",
  lock: {
    amountRaw: "850000000000000",
    decimals: 6,
    detectedAt: DETECTED_AT,
    lockedPercentage: 100,
    metadataId: DEMO_MINT,
    signature: DEMO_SIG,
    slot: 0,
    status: "confirmed",
    unlockAt: UNLOCK_AT,
  },
};

const DEMO_TOKEN: DisplayToken = {
  id: DEMO_MINT,
  name: "NeuralSwap",
  ticker: "$NSWAP",
  tier: TrustTier.SHIPPED,
  tierLabel: "SHIPPED",
  image: "/lckd-token.png",
  metadata: {
    description:
      "AI-routed swaps on Solana. Open source, audited, and shipped by a public builder profile.",
    creatorWallet: DEMO_MINT,
    createdAt: DETECTED_AT,
    buyAmountSol: 0.1,
    launchTx: DEMO_SIG,
    lockTx: DEMO_SIG,
    hasLock: true,
    launchVerifiedAt: DETECTED_AT,
    lockVerifiedAt: DETECTED_AT,
    unlockAt: UNLOCK_AT,
    twitterUrl: "https://x.com/launchlckd",
    telegramUrl: null,
    websiteUrl: "https://neuralswap.app",
  },
  dev: {
    github: "rickzsol",
    provider: "github",
    username: "rickzsol",
    avatar: "R",
    accountAge: "4 years",
    repos: 12,
    commits: 1840,
  },
  repo: {
    name: "lckd",
    lang: "TypeScript",
    stars: 42,
    forks: 7,
    lastPush: "2h",
    commits30d: 96,
  },
  lock: {
    amount: "850M $NSWAP",
    duration: "90 days",
    pct: 22,
    start: "Jul 17, 2026",
    end: "Oct 15, 2026",
  },
  mcap: "$1.2M",
  vol: "$340K",
  price: "$0.0012",
  chg: "+18.4%",
  holders: 1240,
  live: "neuralswap.app",
  liquidity: "$96K",
  mintAddress: DEMO_MINT,
};

const DEMO_CONFIG: LaunchConfig = {
  name: "NeuralSwap",
  ticker: "NSWAP",
  description:
    "AI-routed swaps on Solana. Open source, audited, and shipped by a public builder profile.",
  image: null,
  imageUri: null,
  buyAmountSol: 1.5,
  hasLock: true,
  lockDurationDays: 90,
  lockPercentage: 100,
  githubUsername: "rickzsol",
  githubRepo: "rickzsol/lckd",
  liveUrl: "https://neuralswap.app",
  twitterUrl: "https://x.com/launchlckd",
  telegramUrl: null,
  websiteUrl: "https://neuralswap.app",
};

const DEMO_RESULT: LaunchResult = {
  mintAddress: DEMO_MINT,
  createTxSignature: DEMO_SIG,
  lockTxSignature: DEMO_SIG,
  lockMetadataId: DEMO_MINT,
  lockAmount: "850000000000000",
  unlockTimestamp: Math.floor(new Date(UNLOCK_AT).getTime() / 1000),
  lockBlockhash: null,
  lockLastValidBlockHeight: null,
};

const WIZARD_STATES: LaunchStatus[] = ["idle", "launching", "success", "partial", "error"];

const DEMO_GITHUB: DemoGitHubData = {
  repos: [
    { full_name: "rickzsol/lckd", name: "lckd", description: "Solana launch interface with verifiable time locks", stars: 42, language: "TypeScript" },
    { full_name: "rickzsol/neuralswap", name: "neuralswap", description: "AI-routed swaps on Solana", stars: 18, language: "Rust" },
    { full_name: "rickzsol/solana-scripts", name: "solana-scripts", description: null, stars: 5, language: "TypeScript" },
  ],
  activity: {
    "rickzsol/lckd": {
      description: "Solana launch interface with verifiable time locks",
      language: "TypeScript",
      stars: 42,
      forks: 7,
      pushedAt: "2026-07-17T10:05:00Z",
      commits: [
        { sha: "a142b1f", message: "add launch token button to navbar", date: "2026-07-17T09:40:00Z" },
        { sha: "f270018", message: "fix: make LCKD directory card clickable", date: "2026-07-16T22:12:00Z" },
        { sha: "44ae2e6", message: "docs: record production release", date: "2026-07-16T18:03:00Z" },
        { sha: "feecd85", message: "feat: ship atomic locked token launches", date: "2026-07-15T14:31:00Z" },
        { sha: "9c01d3e", message: "refactor: tighten lock invariant checks", date: "2026-07-14T11:20:00Z" },
      ],
    },
    "rickzsol/neuralswap": {
      description: "AI-routed swaps on Solana",
      language: "Rust",
      stars: 18,
      forks: 3,
      pushedAt: "2026-07-12T08:00:00Z",
      commits: [
        { sha: "1b2c3d4", message: "feat: route scoring v2", date: "2026-07-12T07:45:00Z" },
        { sha: "5e6f7a8", message: "fix: slippage guard on multi-hop", date: "2026-07-10T16:22:00Z" },
      ],
    },
    "rickzsol/solana-scripts": {
      description: null,
      language: "TypeScript",
      stars: 5,
      forks: 0,
      pushedAt: "2026-06-30T12:00:00Z",
      commits: [
        { sha: "c9d8e7f", message: "add priority fee estimator", date: "2026-06-30T11:50:00Z" },
      ],
    },
  },
};

function useDemoWizard(): WizardContext {
  const [step, setStep] = useState(3);
  const [status, setStatus] = useState<LaunchStatus>("idle");
  const [config, setConfig] = useState<LaunchConfig>(DEMO_CONFIG);
  const [imagePreview, setImagePreview] = useState<string | null>("/lckd-token.png");

  return useMemo<WizardContext & { setDemoStatus: (s: LaunchStatus) => void }>(
    () => ({
      step,
      config,
      imagePreview,
      errors: {},
      launchStatus: status,
      launchPhase: 2,
      launchPhases: [...LAUNCH_PHASES_WITH_LOCK],
      recoveryStatus: status === "partial" ? "atomic_submitted" : null,
      recoveryAltStatus: status === "success" ? "closed" : null,
      resolvedFee: status === "launching" ? "0.1 SOL buyback and burn" : null,
      launchResult:
        status === "success"
          ? DEMO_RESULT
          : status === "partial"
            ? { ...DEMO_RESULT, lockTxSignature: DEMO_RESULT.createTxSignature }
            : null,
      errorMessage:
        status === "error"
          ? "Demo error: the atomic transaction was rejected in the wallet."
          : status === "partial"
            ? "Demo state: the atomic transaction is awaiting receipt reconciliation."
            : null,
      computedTier: TrustTier.SHIPPED,
      tierLabel: "SHIPPED",
      updateConfig: (key, value) => setConfig((prev) => ({ ...prev, [key]: value })),
      handleImageUpload: (file) => {
        const reader = new FileReader();
        reader.onload = (e) => setImagePreview(e.target?.result as string);
        reader.readAsDataURL(file);
      },
      removeImage: () => setImagePreview(null),
      goNext: () => setStep((s) => Math.min(4, s + 1)),
      goBack: () => setStep((s) => Math.max(1, s - 1)),
      goToStep: (target) => {
        if (target >= 1 && target <= 4) setStep(target);
      },
      launch: async () => {},
      retryLock: async () => {},
      reset: () => {
        setStatus("idle");
        setStep(1);
      },
      setDemoStatus: setStatus,
    }),
    [step, status, config, imagePreview],
  );
}

function SectionHeading({ num, title, note }: { num: string; title: string; note: string }) {
  return (
    <div className="mx-auto max-w-[1360px] px-4 pt-16 sm:px-6 lg:px-10">
      <div className="border-t border-line pt-6">
        <div className="font-mono text-[13px] font-bold text-accent">
          {num} / {title}
        </div>
        <p className="mt-1 font-mono text-[11px] text-text-3">{note}</p>
      </div>
    </div>
  );
}

export default function DemoClient() {
  const wizard = useDemoWizard() as WizardContext & {
    setDemoStatus: (s: LaunchStatus) => void;
  };

  return (
    <div className="pb-24">
      {/* Demo banner */}
      <div className="mx-auto max-w-[1360px] px-4 pt-24 sm:px-6 lg:px-10">
        <div className="warning-box flex flex-wrap items-center justify-between gap-3">
          <span>
            <span className="callout-title">design demo, dev only</span>
            Fake platform records. Chart and market data are live from DexScreener for{" "}
            {DEMO_MINT.slice(0, 6)}...{DEMO_MINT.slice(-6)}.
          </span>
          <span className="flex gap-3 font-mono text-[11px]">
            <a href="#official" className="text-accent-400 hover:underline">official token</a>
            <a href="#detail" className="text-accent-400 hover:underline">token detail</a>
            <a href="#wizard" className="text-accent-400 hover:underline">launch wizard</a>
          </span>
        </div>
      </div>

      <div id="official" className="-mt-12">
        <SectionHeading
          num="01"
          title="official token page"
          note="/token/lckd with a confirmed launch and verified lock"
        />
        <div className="-mt-24">
          <OfficialTokenClient initialLaunch={DEMO_LAUNCH} monitorUrl={null} />
        </div>
      </div>

      <div id="detail">
        <SectionHeading
          num="02"
          title="token detail page"
          note="/token/[id] with a full platform record (repo, lock, dev profile)"
        />
        <div className="-mt-24">
          <TokenDetailClient t={DEMO_TOKEN} />
        </div>
      </div>

      <div id="wizard">
        <SectionHeading
          num="03"
          title="launch wizard"
          note="all four steps unlocked, plus every launch outcome state"
        />
        <div className="mx-auto mt-5 flex max-w-[680px] flex-wrap items-center gap-1.5 px-4 sm:px-6">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-text-4">
            preview state:
          </span>
          {WIZARD_STATES.map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => wizard.setDemoStatus(state)}
              className={`rounded-control border px-2.5 py-1 font-mono text-[10px] font-bold transition-colors duration-[180ms] ${
                wizard.launchStatus === state
                  ? "border-accent/40 bg-accent-dim text-accent"
                  : "border-line-default bg-surface-2 text-text-3 hover:border-line-strong hover:text-text-2"
              }`}
            >
              {state}
            </button>
          ))}
        </div>
        <div className="-mt-20">
          <DemoGitHubContext.Provider value={DEMO_GITHUB}>
            <WizardPanel wizard={wizard} callbackUrl="/launch" />
          </DemoGitHubContext.Provider>
        </div>
      </div>
    </div>
  );
}
