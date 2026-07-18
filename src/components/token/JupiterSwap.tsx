"use client";

export default function JupiterSwap({
  mintAddress,
  ticker,
}: {
  mintAddress?: string;
  ticker: string;
}) {
  if (!mintAddress) {
    return (
      <div className="rounded-card border border-line-default bg-surface p-4 sm:p-5">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
          Swap
        </div>
        <p className="mt-3 font-mono text-xs leading-relaxed text-text-3">
          Jupiter routing activates once the contract address is live. The swap link will open with ${ticker} preselected.
        </p>
        <div className="mt-4 rounded-control border border-dashed border-line-default bg-surface-deep px-3 py-2.5 text-center font-mono text-[10px] uppercase tracking-wider text-text-4">
          waiting for launch
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
      <div className="mb-4 rounded-control border border-line-default bg-surface-deep px-3 py-3 font-mono text-[10px] leading-[1.6] text-text-3">
        Jupiter will open in a new tab with this token selected. Review the quote, price impact, and transaction in Jupiter before signing.
      </div>
      <a
        href={jupiterUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary block w-full py-3 text-center"
      >
        Open Jupiter Swap
      </a>
    </div>
  );
}
