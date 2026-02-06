"use client";

import { useState } from "react";

export default function DexScreenerChart({ mintAddress }: { mintAddress?: string }) {
  const [isLoaded, setIsLoaded] = useState(false);

  if (!mintAddress) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.015] lg:h-[500px]">
        <div className="text-center">
          <div className="font-mono text-[32px] text-white/10">~</div>
          <p className="mt-2 font-mono text-xs text-[#555]">
            Chart unavailable
          </p>
        </div>
      </div>
    );
  }

  const src = `https://dexscreener.com/solana/${mintAddress}?embed=1&theme=dark&trades=0&info=0`;

  return (
    <div className="relative h-[400px] overflow-hidden rounded-xl border border-white/[0.06] lg:h-[500px]">
      {!isLoaded && (
        <div className="absolute inset-0 animate-pulse bg-white/[0.02]" />
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
