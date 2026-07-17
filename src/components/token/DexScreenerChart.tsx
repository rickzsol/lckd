"use client";

import { useState } from "react";

export default function DexScreenerChart({ mintAddress }: { mintAddress?: string }) {
  const [isLoaded, setIsLoaded] = useState(false);

  if (!mintAddress) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-card border border-line-default bg-surface lg:h-[500px]">
        <div className="text-center">
          <div className="font-mono text-[32px] text-text-4">~</div>
          <p className="mt-2 font-mono text-xs text-text-3">
            Chart unavailable
          </p>
        </div>
      </div>
    );
  }

  const src = `https://dexscreener.com/solana/${mintAddress}?embed=1&theme=dark&trades=0&info=0`;

  return (
    <div className="relative h-[400px] overflow-hidden rounded-card border border-line-default bg-surface lg:h-[500px]">
      {!isLoaded && (
        <div className="absolute inset-0 animate-pulse bg-surface-2" />
      )}
      <iframe
        src={src}
        title="DexScreener Chart"
        className="h-full w-full border-0"
        loading="lazy"
        onLoad={() => setIsLoaded(true)}
      />
    </div>
  );
}
