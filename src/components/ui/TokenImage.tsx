"use client";

import { useState } from "react";
import Image from "next/image";

export default function TokenImage({ src, alt }: { src: string; alt: string }) {
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
      width={96}
      height={96}
      className="h-full w-full object-cover"
      unoptimized
      onError={() => setHasError(true)}
    />
  );
}
