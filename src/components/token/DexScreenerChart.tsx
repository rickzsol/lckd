"use client";

import { useState } from "react";
import Image from "next/image";

export default function DexScreenerChart({ mintAddress }: { mintAddress?: string }) {
  const [isLoaded, setIsLoaded] = useState(false);

  if (!mintAddress) {
    return (
      <div className="flex h-[360px] items-center justify-center rounded-card border border-line-default bg-surface lg:h-[540px] xl:h-[600px]">
        <div className="flex flex-col items-center text-center">
          <Image
            src="/logo.png"
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 opacity-60 grayscale"
          />
          <p className="mt-4 font-mono text-xs font-semibold text-text-2">
            Chart goes live with the CA
          </p>
          <p className="mt-1.5 max-w-[260px] font-mono text-[10px] leading-relaxed text-text-3">
            Price history appears here once the token is created and DexScreener indexes the pair.
          </p>
        </div>
      </div>
    );
  }

  const src = `https://dexscreener.com/solana/${mintAddress}?embed=1&theme=dark&trades=0&info=0`;

  return (
    <div className="relative h-[400px] overflow-hidden rounded-card border border-line-default bg-surface lg:h-[540px] xl:h-[600px]">
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
