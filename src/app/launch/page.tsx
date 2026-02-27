"use client";

import { Fragment } from "react";
import { useLaunchWizard, STEP_LABELS, STEP_COUNT } from "@/hooks/useLaunchWizard";
import StepTokenDetails from "./StepTokenDetails";
import StepLockConfig from "./StepLockConfig";
import StepGitHub from "./StepGitHub";
import StepReview from "./StepReview";

export default function LaunchPage() {
  const wizard = useLaunchWizard();

  return (
    <div className="mx-auto max-w-[600px] px-4 py-6">
      <h2 className="mb-1 font-sans text-[clamp(24px,6vw,32px)] font-extrabold text-white">
        Launch a Token
      </h2>
      <p className="mb-7 font-mono text-xs text-[#555]">
        Create on pump.fun &middot; Lock with Streamflow &middot; Verify with
        GitHub
      </p>

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
                    className={`mt-4 h-px flex-1 transition-colors ${isComplete ? "bg-accent/60" : "bg-white/8"}`}
                  />
                )}
                <button
                  onClick={() => {
                    if (isComplete) wizard.goToStep(num);
                  }}
                  className={`flex flex-col items-center gap-1.5 ${isComplete ? "cursor-pointer" : "cursor-default"}`}
                  disabled={isFuture}
                  aria-current={isActive ? "step" : undefined}
                >
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full border-2 font-mono text-[11px] font-bold transition-all ${
                      isActive
                        ? "border-accent bg-accent text-black"
                        : isComplete
                          ? "border-accent bg-accent/15 text-accent"
                          : "border-white/10 bg-transparent text-white/25"
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
                    className={`whitespace-nowrap font-mono text-[9px] transition-colors ${
                      isActive
                        ? "text-accent"
                        : isComplete
                          ? "text-accent/50"
                          : "text-white/20"
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
        <div className="mb-6 flex gap-[3px]">
          {Array.from({ length: STEP_COUNT }).map((_, i) => (
            <div
              key={i}
              className="h-[3px] flex-1 rounded-sm transition-colors duration-300"
              style={{
                background:
                  i + 1 <= wizard.step
                    ? "#8b5cf6"
                    : "rgba(255,255,255,0.06)",
              }}
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
