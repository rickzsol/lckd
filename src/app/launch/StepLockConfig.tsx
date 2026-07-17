"use client";

import type { WizardContext } from "@/hooks/useLaunchWizard";

const DURATION_PRESETS = [7, 30, 90, 180, 365];
const PERCENTAGE_PRESETS = [51, 75, 100];

export default function StepLockConfig({ w }: { w: WizardContext }) {
  return (
    <div>
      <h2 className="mb-5 font-mono text-[13px] font-bold text-accent">
        02 / Lock configuration
      </h2>

      <div className="flex flex-col gap-5">
        <div>
          <label htmlFor="buy-amount" className="form-label">
            Buy Amount (SOL)
          </label>
          <input
            id="buy-amount"
            type="number"
            min={0.1}
            step={0.1}
            className={`form-input tabular-nums ${w.errors.buyAmountSol ? "form-input-error" : ""}`}
            value={w.config.buyAmountSol}
            onChange={(event) =>
              w.updateConfig("buyAmountSol", Number.parseFloat(event.target.value) || 0)
            }
          />
          {w.errors.buyAmountSol ? (
            <div className="mt-1 font-mono text-[11px] text-danger">
              {w.errors.buyAmountSol}
            </div>
          ) : (
            <div className="mt-1 font-mono text-[10px] text-text-4">
              This SOL buys your initial supply, which must be locked.
            </div>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="lock-duration" className="form-label mb-0">
              Lock Duration
            </label>
            <span className="font-mono text-sm font-bold tabular-nums text-accent">
              {w.config.lockDurationDays} days
            </span>
          </div>
          <input
            id="lock-duration"
            type="range"
            min={7}
            max={365}
            value={w.config.lockDurationDays}
            onChange={(event) =>
              w.updateConfig("lockDurationDays", Number(event.target.value))
            }
            className="w-full accent-accent"
          />
          <div className="mt-2 flex gap-1.5">
            {DURATION_PRESETS.map((duration) => (
              <button
                key={duration}
                type="button"
                onClick={() => w.updateConfig("lockDurationDays", duration)}
                className={`flex-1 rounded-control border py-1.5 font-mono text-[10px] font-bold transition-colors duration-[180ms] ${
                  w.config.lockDurationDays === duration
                    ? "border-accent/40 bg-accent-dim text-accent"
                    : "border-line-default bg-surface-2 text-text-3 hover:border-line-strong hover:text-text-2"
                }`}
              >
                {duration}d
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="lock-pct" className="form-label mb-0">
              Tokens to Lock
            </label>
            <span className="font-mono text-sm font-bold tabular-nums text-accent">
              {w.config.lockPercentage}%
            </span>
          </div>
          <input
            id="lock-pct"
            type="range"
            min={51}
            max={100}
            value={w.config.lockPercentage}
            onChange={(event) =>
              w.updateConfig("lockPercentage", Number(event.target.value))
            }
            className="w-full accent-accent"
          />
          <div className="mt-2 flex gap-1.5">
            {PERCENTAGE_PRESETS.map((percentage) => (
              <button
                key={percentage}
                type="button"
                onClick={() => w.updateConfig("lockPercentage", percentage)}
                className={`flex-1 rounded-control border py-1.5 font-mono text-[10px] font-bold transition-colors duration-[180ms] ${
                  w.config.lockPercentage === percentage
                    ? "border-accent/40 bg-accent-dim text-accent"
                    : "border-line-default bg-surface-2 text-text-3 hover:border-line-strong hover:text-text-2"
                }`}
              >
                {percentage}%
              </button>
            ))}
          </div>
        </div>

        <div className="lock-preview">
          <div className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
            Lock Preview
          </div>
          <div className="font-mono text-xs text-text-1">
            You will buy <span className="font-bold tabular-nums text-accent">{w.config.buyAmountSol} SOL</span>{" "}
            worth of <span className="font-bold">${w.config.ticker || "???"}</span>{" "}
            and lock <span className="font-bold tabular-nums text-accent">{w.config.lockPercentage}%</span>{" "}
            for <span className="font-bold tabular-nums text-accent">{w.config.lockDurationDays} days</span>.
          </div>
          <div className="mt-2 font-mono text-[10px] text-text-3">
            Non-cancelable, Streamflow token lock
          </div>
        </div>

        <div className="warning-box flex items-start gap-2 leading-relaxed">
          <span aria-hidden="true">!</span>
          <span>
            The lock cannot be canceled, topped up, paused, or transferred. Tokens unlock in full at the selected date.
          </span>
        </div>
      </div>

      <div className="mt-6 flex gap-2.5">
        <button type="button" onClick={w.goBack} className="btn-secondary flex-1 py-3">
          &larr; back
        </button>
        <button type="button" onClick={w.goNext} className="btn-primary flex-[2] py-3">
          continue &rarr;
        </button>
      </div>
    </div>
  );
}
