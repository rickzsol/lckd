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
      <div className="rounded-card border border-line-default bg-surface p-4">
        <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
          Swap
        </div>
        <div className="flex h-[120px] items-center justify-center">
          <p className="font-mono text-xs text-text-3">Swap unavailable</p>
        </div>
      </div>
    );
  }

  const jupiterUrl = `https://jup.ag/swap/SOL-${encodeURIComponent(mintAddress)}`;

  return (
    <div className="flex flex-1 flex-col rounded-card border border-line-default bg-surface p-4">
      <div className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
        Swap SOL &rarr; {ticker}
      </div>
      <div className="mb-4 rounded-control border border-line-default bg-surface-deep px-3 py-3 font-mono text-[10px] leading-[1.6] text-text-3">
        Jupiter will open in a new tab with this token selected. Review the quote, price impact, and transaction in Jupiter before signing.
      </div>
      <div className="flex-1" />
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
