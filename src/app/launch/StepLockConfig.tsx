"use client";

import type { WizardContext } from "@/hooks/useLaunchWizard";

const DURATION_PRESETS = [7, 30, 90, 180, 365];
const PERCENTAGE_PRESETS = [50, 75, 100];

export default function StepLockConfig({ w }: { w: WizardContext }) {
  const isSkipped = w.config.skipLock;

  return (
    <div>
      <div className="mb-5 font-mono text-[13px] font-bold text-emerald-accent">
        02 &mdash; Lock Configuration
      </div>

      <div className="flex flex-col gap-5">
        {/* Buy Amount */}
        <div>
          <label
            htmlFor="buy-amount"
            className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#555]"
          >
            Buy Amount (SOL)
          </label>
          <input
            id="buy-amount"
            type="number"
            min={0.1}
            step={0.1}
            className="form-input"
            value={w.config.buyAmountSol}
            onChange={(e) =>
              w.updateConfig("buyAmountSol", parseFloat(e.target.value) || 0)
            }
          />
          {w.errors.buyAmountSol ? (
            <div className="mt-1 font-mono text-[10px] text-red-400">
              {w.errors.buyAmountSol}
            </div>
          ) : (
            <div className="mt-1 font-mono text-[10px] text-[#444]">
              {isSkipped
                ? "This SOL buys your initial supply"
                : "This SOL buys your initial supply, which gets locked"}
            </div>
          )}
        </div>

        {/* Skip Lock Toggle */}
        <div>
          <button
            type="button"
            onClick={() => w.updateConfig("skipLock", !isSkipped)}
            className={`flex w-full items-center justify-between rounded-lg border px-3.5 py-3 transition-colors ${
              isSkipped
                ? "border-red-500/30 bg-red-500/5"
                : "border-white/8 bg-white/2 hover:border-white/15"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={`flex h-4 w-7 items-center rounded-full transition-colors ${
                  isSkipped ? "justify-end bg-red-500" : "justify-start bg-white/10"
                }`}
              >
                <div className="mx-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-all" />
              </div>
              <span className="font-mono text-[11px] font-bold text-white">
                Skip vesting lock
              </span>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase ${
                isSkipped
                  ? "bg-red-500/15 text-red-400"
                  : "bg-white/5 text-[#555]"
              }`}
            >
              {isSkipped ? "no lock" : "locked"}
            </span>
          </button>

          {isSkipped && (
            <div className="mt-2.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3.5 py-3">
              <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wider text-red-400">
                Highly unrecommended
              </div>
              <div className="font-mono text-[10px] leading-relaxed text-red-400/80">
                Launching without a vesting lock means your dev tokens are fully
                liquid. Holders will have no on-chain guarantee that you
                won&apos;t sell. This will significantly hurt trust and your
                trust tier.
              </div>
            </div>
          )}
        </div>

        {/* Lock Duration — hidden when skipped */}
        {!isSkipped && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="lock-duration"
                className="font-mono text-[10px] uppercase tracking-wider text-[#555]"
              >
                Lock Duration
              </label>
              <span className="font-mono text-sm font-bold text-emerald-accent">
                {w.config.lockDurationDays} days
              </span>
            </div>
            <input
              id="lock-duration"
              type="range"
              min={7}
              max={365}
              value={w.config.lockDurationDays}
              onChange={(e) =>
                w.updateConfig("lockDurationDays", +e.target.value)
              }
              className="w-full accent-emerald-accent"
            />
            <div className="mt-2 flex gap-1.5">
              {DURATION_PRESETS.map((d) => (
                <button
                  key={d}
                  onClick={() => w.updateConfig("lockDurationDays", d)}
                  className={`flex-1 rounded-md border py-1.5 font-mono text-[10px] font-bold transition-colors ${
                    w.config.lockDurationDays === d
                      ? "border-emerald-accent/40 bg-emerald-accent/10 text-emerald-accent"
                      : "border-white/8 bg-white/3 text-[#555] hover:border-white/15 hover:text-[#888]"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Lock Percentage — hidden when skipped */}
        {!isSkipped && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="lock-pct"
                className="font-mono text-[10px] uppercase tracking-wider text-[#555]"
              >
                Tokens to Lock
              </label>
              <span className="font-mono text-sm font-bold text-emerald-accent">
                {w.config.lockPercentage}%
              </span>
            </div>
            <input
              id="lock-pct"
              type="range"
              min={50}
              max={100}
              value={w.config.lockPercentage}
              onChange={(e) => w.updateConfig("lockPercentage", +e.target.value)}
              className="w-full accent-emerald-accent"
            />
            <div className="mt-2 flex gap-1.5">
              {PERCENTAGE_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => w.updateConfig("lockPercentage", p)}
                  className={`flex-1 rounded-md border py-1.5 font-mono text-[10px] font-bold transition-colors ${
                    w.config.lockPercentage === p
                      ? "border-emerald-accent/40 bg-emerald-accent/10 text-emerald-accent"
                      : "border-white/8 bg-white/3 text-[#555] hover:border-white/15 hover:text-[#888]"
                  }`}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Live Summary */}
        <div className="lock-preview">
          <div
            className={`mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
              isSkipped ? "text-red-400" : "text-emerald-accent"
            }`}
          >
            {isSkipped ? "Launch Preview" : "Lock Preview"}
          </div>
          <div className="font-mono text-xs text-white">
            You will buy{" "}
            <span className="font-bold text-emerald-accent">
              {w.config.buyAmountSol} SOL
            </span>{" "}
            worth of{" "}
            <span className="font-bold">
              ${w.config.ticker || "???"}
            </span>
            {isSkipped ? (
              <span className="text-red-400"> with no vesting lock</span>
            ) : (
              <>
                {" "}and lock{" "}
                <span className="font-bold text-emerald-accent">
                  {w.config.lockPercentage}%
                </span>{" "}
                for{" "}
                <span className="font-bold text-emerald-accent">
                  {w.config.lockDurationDays} days
                </span>
              </>
            )}
          </div>
          {!isSkipped && (
            <div className="mt-2 font-mono text-[10px] text-[#555]">
              Linear unlock &middot; Non-cancelable &middot; Streamflow vesting
            </div>
          )}
        </div>

        {/* Info note */}
        {!isSkipped && (
          <div className="flex items-start gap-2 rounded-lg border border-white/6 bg-white/2 px-3 py-2.5">
            <span className="mt-0.5 text-[12px] text-[#555]">i</span>
            <span className="font-mono text-[10px] leading-relaxed text-[#555]">
              The lock is non-cancelable and uses Streamflow linear vesting.
              Tokens unlock gradually over the full duration. This cannot be
              reversed after launch.
            </span>
          </div>
        )}
      </div>

      <div className="mt-6 flex gap-2.5">
        <button onClick={w.goBack} className="btn-secondary flex-1 py-3">
          &larr; back
        </button>
        <button onClick={w.goNext} className="btn-primary flex-[2] py-3">
          continue &rarr;
        </button>
      </div>
    </div>
  );
}
