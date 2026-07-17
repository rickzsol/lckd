"use client";

import { useCallback, useState } from "react";

export interface AttestationLineData {
  attestationPda: string;
  explorerUrl: string;
}

/**
 * Lock-card attestation line. Renders only when a finalized unexpired
 * attestation row exists. Mono, lowercase, claims-as-proofs voice: the tier is
 * attested on-chain and anyone can verify it without trusting LCKD.
 */
export default function AttestationLine({ attestationPda, explorerUrl }: AttestationLineData) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(attestationPda);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [attestationPda]);

  const short = `${attestationPda.slice(0, 4)}…${attestationPda.slice(-4)}`;

  return (
    <div className="callout-success !mt-2 !inline-flex items-center gap-2">
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono hover:text-accent-400"
      >
        attested on-chain &middot; sas #{short} <span aria-hidden="true">&#8599;</span>
      </a>
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy attestation address"
        className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-3 transition-colors duration-180 ease-out hover:text-accent-400"
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}
