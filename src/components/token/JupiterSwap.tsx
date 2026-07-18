"use client";

export default function JupiterSwap({
  mintAddress,
  ticker,
  isWide = false,
}: {
  mintAddress?: string;
  ticker: string;
  /** Horizontal layout for full-row placement when no links card is beside it. */
  isWide?: boolean;
}) {
  if (!mintAddress) {
    return (
      <div className="rounded-card border border-line-default bg-surface p-4 sm:p-5">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
          Swap
        </div>
        <div className={isWide ? "md:flex md:items-center md:gap-6" : ""}>
          <p className="mt-3 font-mono text-xs leading-relaxed text-text-3 md:flex-1">
            Jupiter routing activates once the contract address is live. The swap link will open with ${ticker} preselected.
          </p>
          <div className={`mt-4 rounded-control border border-dashed border-line-default bg-surface-deep px-3 py-2.5 text-center font-mono text-[10px] uppercase tracking-wider text-text-4 ${isWide ? "md:mt-3 md:shrink-0 md:px-8" : ""}`}>
            waiting for launch
          </div>
        </div>
      </div>
    );
  }

  const jupiterUrl = `https://jup.ag/swap/SOL-${encodeURIComponent(mintAddress)}`;

  return (
    <div className="rounded-card border border-line-default bg-surface p-4 sm:p-5">
      <div className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
        Swap SOL &rarr; {ticker}
      </div>
      <div className={isWide ? "md:flex md:items-center md:gap-6" : ""}>
        <div className={`mb-4 rounded-control border border-line-default bg-surface-deep px-3 py-3 font-mono text-[10px] leading-[1.6] text-text-3 ${isWide ? "md:mb-0 md:flex-1" : ""}`}>
          Jupiter will open in a new tab with this token selected. Review the quote, price impact, and transaction in Jupiter before signing.
        </div>
        <a
          href={jupiterUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`btn-primary block w-full py-3 text-center ${isWide ? "md:w-auto md:shrink-0 md:px-10" : ""}`}
        >
          Open Jupiter Swap
        </a>
      </div>
    </div>
  );
}
