"use client";

import { useState } from "react";
import Image from "next/image";

// Mirrors images.remotePatterns in next.config.ts. Hosts outside this list
// render unoptimized because next/image throws on un-allowlisted domains.
const EXACT_HOSTS = [
  "ipfs.io",
  "cf-ipfs.com",
  "nftstorage.link",
  "gateway.pinata.cloud",
  "pump.fun",
  "arweave.net",
  "avatars.githubusercontent.com",
  "i.imgur.com",
];
const HOST_SUFFIXES = [
  ".ipfs.w3s.link",
  ".nftstorage.link",
  ".pinata.cloud",
  ".mypinata.cloud",
  ".pump.fun",
];

function canOptimize(src: string): boolean {
  if (src.startsWith("/")) return true;
  try {
    const host = new URL(src).hostname;
    return (
      EXACT_HOSTS.includes(host) ||
      HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
    );
  } catch {
    return false;
  }
}

export default function TokenImage({
  src,
  alt,
  size = 48,
  isEager = false,
}: {
  src: string;
  alt: string;
  size?: number;
  isEager?: boolean;
}) {
  const [hasError, setHasError] = useState(false);
  const isUrl = src.startsWith("http") || src.startsWith("/");

  if (!isUrl || hasError) {
    return (
      <span className="flex h-full w-full items-center justify-center rounded-[10px] border border-[rgba(43,209,126,0.25)] bg-accent-dim font-mono text-xs font-bold text-accent-400">
        {hasError ? alt.slice(0, 2).toUpperCase() : src}
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      sizes={`${size}px`}
      quality={75}
      loading={isEager ? "eager" : "lazy"}
      fetchPriority={isEager ? "high" : "auto"}
      className="h-full w-full object-cover"
      unoptimized={!canOptimize(src)}
      onError={() => setHasError(true)}
    />
  );
}
