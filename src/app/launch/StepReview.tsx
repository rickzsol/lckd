"use client";

import Image from "next/image";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import Badge from "@/components/ui/Badge";
import WalletMultiButton from "@/components/ui/WalletButton";
import type { WizardContext } from "@/hooks/useLaunchWizard";

const SOLSCAN_BASE = "https://solscan.io";

export default function StepReview({ w }: { w: WizardContext }) {
  if (w.launchStatus === "success") return <SuccessView w={w} />;
  if (w.launchStatus === "partial") return <PartialView w={w} />;
  if (w.launchStatus === "error") return <ErrorView w={w} />;
  if (w.launchStatus === "launching") return <LaunchingView w={w} />;

  return <ReviewForm w={w} />;
}

// Review form (idle state)────────────────────────────────────────────────

function ReviewForm({ w }: { w: WizardContext }) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const estimatedOverhead = 0.23;
  const estimatedCost = (w.config.buyAmountSol + estimatedOverhead).toFixed(2);

  const handleLaunch = () => {
    if (!publicKey || !signTransaction) return;
    w.launch({ publicKey, signTransaction, connection });
  };

  return (
    <div>
      <h2 className="mb-5 font-mono text-[13px] font-bold text-accent">
        04 / Review and launch
      </h2>

      {/* Token summary */}
      <div className="mb-3 rounded-card border border-line-default bg-surface p-4">
        <div className="mb-2.5 font-mono text-[10px] uppercase tracking-wider text-text-3">
          Token
        </div>
        <div className="flex items-center gap-3">
          {(w.imagePreview ?? w.config.imageUri) && (
            <Image
              src={w.imagePreview ?? w.config.imageUri!}
              alt={`${w.config.name} token preview`}
              width={40}
              height={40}
              className="h-10 w-10 rounded-control object-cover"
              unoptimized
            />
          )}
          <div>
            <div className="font-mono text-sm font-bold text-text-1">
              {w.config.name}{" "}
              <span className="text-accent">${w.config.ticker}</span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-text-3">
              {w.config.description.length > 80
                ? w.config.description.slice(0, 80) + "..."
                : w.config.description}
            </div>
          </div>
        </div>
      </div>

      {/* Transaction Preview */}
      <div className="mb-3 rounded-card border border-line-default bg-surface p-4">
        <div className="mb-2.5 font-mono text-[10px] uppercase tracking-wider text-text-3">
          Transaction Preview
        </div>
        {[
          {
            n: "1",
            label: "Create + Buy",
            detail: `${w.config.name} ($${w.config.ticker}) on pump.fun, ${w.config.buyAmountSol} SOL buy`,
          },
          {
            n: "2",
            label: "Time Lock Tokens",
            detail: `${w.config.lockPercentage}% locked for ${w.config.lockDurationDays} days via Streamflow`,
          },
        ].map((item) => (
          <div
            key={item.n}
            className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0"
          >
            <span className="review-num">{item.n}</span>
            <div>
              <div className="font-mono text-xs font-semibold text-text-1">
                {item.label}
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-text-3">
                {item.detail}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Cost estimate */}
      <div className="mb-3 flex items-center justify-between rounded-control border border-line-default bg-surface px-3.5 py-3 font-mono text-xs text-text-3">
        <span>Estimated cost</span>
        <span className="font-bold tabular-nums text-text-1">
          ~{estimatedCost} SOL
          <span className="ml-1 text-[10px] font-normal text-text-3">
            (buy + rent + fees)
          </span>
        </span>
      </div>

      {/* Tier preview */}
      <div className="mb-4 flex items-center justify-between rounded-control border border-line-default bg-surface px-3.5 py-3 font-mono text-xs text-text-3">
        <span>Trust tier</span>
        <Badge tier={w.computedTier} label={`Tier ${w.computedTier} (${w.tierLabel})`} />
      </div>

      {/* Info box */}
      <div className="warning-box mb-4">
        <span className="callout-title">before you sign</span>
        Two transactions and two wallet approvals. Create and buy confirms first. The
        Streamflow time lock is built and submitted second. A failure in the second transaction
        does not reverse token creation.
      </div>

      {/* Actions */}
      {!connected ? (
        <div className="flex flex-col items-center gap-3">
          <div className="font-mono text-xs text-text-3">
            Connect your wallet to launch
          </div>
          <WalletMultiButton />
        </div>
      ) : (
        <div className="flex gap-2.5">
          <button type="button" onClick={w.goBack} className="btn-secondary flex-1 py-3">
            &larr; back
          </button>
          <button type="button" onClick={handleLaunch} className="btn-launch flex-[2]">
            LAUNCH TOKEN
          </button>
        </div>
      )}
    </div>
  );
}

// Launching view (in progress)───────────────────────────────────────────

function LaunchingView({ w }: { w: WizardContext }) {
  return (
    <div className="flex flex-col items-center py-12" role="status" aria-live="polite" aria-atomic="true">
      <div className="mb-6 h-12 w-12 animate-spin rounded-full border-[3px] border-line-strong border-t-accent" aria-hidden="true" />

      <div className="mb-6 font-mono text-sm font-bold text-text-1">
        Processing {w.config.name}...
      </div>

      <div className="w-full max-w-[320px]">
        {w.launchPhases.map((phase, i) => {
          const isActive = i === w.launchPhase;
          const isComplete = i < w.launchPhase;
          const isPending = i > w.launchPhase;

          return (
            <div
              key={i}
              className={`flex items-center gap-3 py-2 font-mono text-xs transition-opacity duration-[180ms] ${isPending ? "opacity-30" : "opacity-100"}`}
            >
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
                {isComplete ? (
                  <svg className="h-3.5 w-3.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : isActive ? (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />
                )}
              </span>
              <span
                className={
                  isActive
                    ? "text-text-1"
                    : isComplete
                      ? "text-accent/60"
                      : "text-text-3"
                }
              >
                {phase}
              </span>
            </div>
          );
        })}
      </div>

      {/* Wallet hint for signature phases */}
      {(w.launchPhase === 2 || w.launchPhase === 6) && (
        <div className="mt-6 rounded-control border border-accent/20 bg-accent-dim px-4 py-2.5 font-mono text-[11px] text-accent">
          Check your wallet for a signature request
        </div>
      )}
    </div>
  );
}

// Error view (full failure)──────────────────────────────────────────────

function ErrorView({ w }: { w: WizardContext }) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const handleRetry = () => {
    if (!publicKey || !signTransaction) return;
    w.launch({ publicKey, signTransaction, connection });
  };

  return (
    <div className="flex flex-col items-center py-10">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border-2 border-danger bg-danger/10">
        <svg className="h-8 w-8 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>

      <div className="mb-1 font-sans text-xl font-bold tracking-[-0.01em] text-text-1">
        Launch failed
      </div>

      {w.errorMessage && (
        <div className="error-box mb-6 max-w-[360px]">
          <span className="callout-title">error</span>
          {w.errorMessage}
        </div>
      )}

      <div className="flex w-full max-w-[320px] gap-2.5">
        <button type="button" onClick={w.reset} className="btn-secondary flex-1 py-3">
          Start Over
        </button>
        <button type="button" onClick={handleRetry} className="btn-primary flex-[2] py-3">
          Retry Launch
        </button>
      </div>
    </div>
  );
}

// Partial view (create succeeded, lock failed)───────────────────────────

function PartialView({ w }: { w: WizardContext }) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const handleRetryLock = () => {
    if (!publicKey || !signTransaction) return;
    w.retryLock({ publicKey, signTransaction, connection });
  };

  return (
    <div className="flex flex-col items-center py-10">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border-2 border-warn bg-warn/10">
        <svg className="h-8 w-8 text-warn" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </div>

      <div className="mb-1 font-sans text-xl font-bold tracking-[-0.01em] text-text-1">
        Launch needs attention
      </div>
      <div className="mb-4 max-w-[360px] text-center font-mono text-xs text-text-3">
        A transaction signature was submitted. This page will not create another token or
        lock while that signature is stored. Check the receipts before retrying, and do not
        treat the tokens as locked until the Streamflow account verifies.
      </div>

      {w.launchResult?.createTxSignature && (
        <a
          href={`${SOLSCAN_BASE}/tx/${w.launchResult.createTxSignature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 font-mono text-[10px] text-accent-400 underline underline-offset-2 hover:text-accent-300"
        >
          View create tx on Solscan
        </a>
      )}

      {w.launchResult?.lockTxSignature && (
        <a
          href={`${SOLSCAN_BASE}/tx/${w.launchResult.lockTxSignature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 font-mono text-[10px] text-accent-400 underline underline-offset-2 hover:text-accent-300"
        >
          View lock tx on Solscan
        </a>
      )}

      {w.errorMessage && (
        <div className="warning-box mb-5 max-w-[360px]">
          <span className="callout-title">what happened</span>
          {w.errorMessage}
        </div>
      )}

      <button type="button" onClick={handleRetryLock} className="btn-launch w-full max-w-[320px]">
        VERIFY / RETRY LOCK
      </button>
    </div>
  );
}

// Success view────────────────────────────────────────────────────────────

const CONFETTI = Array.from({ length: 20 }, (_, i) => {
  const seed = (i * 7 + 13) % 100;
  const s2 = (i * 11 + 3) % 100;
  const s3 = (i * 17 + 7) % 100;
  const s4 = (i * 23 + 11) % 100;
  const s5 = (i * 29 + 5) % 100;
  const s6 = (i * 31 + 9) % 100;
  return {
    w: 4 + (seed / 100) * 6,
    h: 4 + (s2 / 100) * 6,
    left: 10 + (s3 / 100) * 80,
    top: -5 - (s4 / 100) * 10,
    bg: ["#2BD17E", "#4ADE8F", "#7CE8AC", "#1FB368", "#178A52"][i % 5],
    dur: 2 + (s5 / 100) * 2,
    delay: (s6 / 100) * 1.5,
  };
});

function SuccessView({ w }: { w: WizardContext }) {
  const mintAddr = w.launchResult?.mintAddress;
  const createSig = w.launchResult?.createTxSignature;
  const lockSig = w.launchResult?.lockTxSignature;

  return (
    <div className="flex flex-col items-center py-10">
      {/* Confetti particles */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {CONFETTI.map((c, i) => (
          <span
            key={i}
            className="absolute block rounded-full"
            style={{
              width: `${c.w}px`,
              height: `${c.h}px`,
              left: `${c.left}%`,
              top: `${c.top}%`,
              background: c.bg,
              opacity: 0,
              animation: `confetti-fall ${c.dur}s ${c.delay}s ease-out forwards`,
            }}
          />
        ))}
      </div>

      {/* Success checkmark */}
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border-2 border-accent bg-accent/10">
        <svg
          className="h-8 w-8 text-accent"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <div className="mb-1 font-sans text-xl font-bold tracking-[-0.01em] text-text-1">
        Token created
      </div>
      <div className="mb-2 font-mono text-xs text-text-3">
        {w.config.name} (${w.config.ticker}) is confirmed and the time lock is verified
      </div>

      {/* Mint address */}
      {mintAddr && (
        <div className="mb-5 rounded-control border border-line-default bg-surface px-3.5 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-3">
            Mint Address
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-text-1">
            {mintAddr.slice(0, 16)}...{mintAddr.slice(-8)}
          </div>
        </div>
      )}

      {/* Links */}
      <div className="flex w-full max-w-[320px] flex-col gap-2">
        {mintAddr && (
          <a
            href={`/token/${mintAddr}`}
            className="btn-primary w-full py-3 text-center"
          >
            View Token Page
          </a>
        )}
        <div className="flex gap-2">
          {mintAddr && (
            <a
              href={`https://pump.fun/coin/${mintAddr}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary flex-1 py-2.5 text-center text-[10px]"
            >
              pump.fun
            </a>
          )}
          {lockSig && (
            <a
              href={`${SOLSCAN_BASE}/tx/${lockSig}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary flex-1 py-2.5 text-center text-[10px]"
            >
              Lock receipt
            </a>
          )}
          {createSig && (
            <a
              href={`${SOLSCAN_BASE}/tx/${createSig}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary flex-1 py-2.5 text-center text-[10px]"
            >
              Solscan
            </a>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={w.reset}
        className="mt-6 font-mono text-[11px] text-text-4 underline underline-offset-[3px] transition-colors duration-[180ms] hover:text-text-3"
      >
        Launch another token
      </button>
    </div>
  );
}
