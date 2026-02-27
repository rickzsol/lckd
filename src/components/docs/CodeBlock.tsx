"use client";

import { useState, useCallback } from "react";

interface CodeBlockProps {
  code: string;
  lang?: string;
}

export default function CodeBlock({ code, lang }: CodeBlockProps) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }, [code]);

  return (
    <div className="group relative overflow-hidden rounded-lg border border-card-border bg-card-bg">
      {lang && (
        <div className="flex items-center justify-between border-b border-card-border px-4 py-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
            {lang}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="font-mono text-[10px] text-text-muted transition-colors hover:text-accent"
          >
            {isCopied ? "copied" : "copy"}
          </button>
        </div>
      )}
      {!lang && (
        <button
          type="button"
          onClick={handleCopy}
          className="absolute right-3 top-3 font-mono text-[10px] text-text-muted opacity-0 transition-all hover:text-accent group-hover:opacity-100"
        >
          {isCopied ? "copied" : "copy"}
        </button>
      )}
      <pre className="overflow-x-auto p-4">
        <code className="font-mono text-[13px] leading-relaxed text-text-primary">
          {code}
        </code>
      </pre>
    </div>
  );
}
