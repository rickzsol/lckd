"use client";

import { Fragment } from "react";
import { STEP_LABELS, STEP_COUNT, type WizardContext } from "@/hooks/useLaunchWizard";
import StepTokenDetails from "./StepTokenDetails";
import StepLockConfig from "./StepLockConfig";
import StepGitHub from "./StepGitHub";
import StepReview from "./StepReview";

export default function WizardPanel({ wizard }: { wizard: WizardContext }) {
  return (
    <div className="mx-auto max-w-[680px] px-4 pt-28 pb-16 sm:px-6">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-sans text-[clamp(24px,6vw,32px)] font-bold tracking-[-0.02em] text-text-1">
          Launch a token
        </h1>
        {wizard.launchStatus === "idle" && (
          <span className="font-mono text-[11px] tabular-nums text-text-4">
            step {String(wizard.step).padStart(2, "0")} / {String(STEP_COUNT).padStart(2, "0")}
          </span>
        )}
      </div>
      <p className="mb-6 font-mono text-xs text-text-3">
        Create on pump.fun &middot; confirm &middot; lock separately with Streamflow
      </p>

      <div className="warning-box mb-6">
        <span className="callout-title">lock is a separate signature</span>
        Locking requires a second wallet signature. If token creation succeeds and the lock
        fails, the token remains created and the purchased tokens remain in your wallet until
        you retry the lock.
      </div>

      <div className="relative overflow-hidden rounded-modal border border-line-default bg-surface p-5 sm:p-8">
      {/* Step indicator */}
      {wizard.launchStatus === "idle" && (
        <div className="mb-7 flex items-start border-b border-line pb-6">
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

      {/* Steps */}
      {wizard.step === 1 && <StepTokenDetails w={wizard} />}
      {wizard.step === 2 && <StepLockConfig w={wizard} />}
      {wizard.step === 3 && <StepGitHub w={wizard} />}
      {wizard.step === 4 && <StepReview w={wizard} />}
      </div>
    </div>
  );
}
