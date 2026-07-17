"use client";

import { useState, useCallback } from "react";

interface CodeBlockProps {
  code: string;
  lang?: string;
}

function renderLine(line: string) {
  if (line.startsWith("$ ")) {
    return (
      <>
        <span className="text-text-3">$</span>{" "}
        <span className="text-accent-300">{line.slice(2)}</span>
      </>
    );
  }
  return line;
}

export default function CodeBlock({ code, lang }: CodeBlockProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyError(false);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }, [code]);

  const lines = code.split("\n");
  const isTerminal = lang === "bash" || lang === "sh" || lang === "shell";

  return (
    <div className="group relative overflow-hidden rounded-card border border-line-default bg-surface-deep">
      {lang && (
        <div className="flex items-center justify-between border-b border-line-default px-4 py-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-text-3">
            {lang}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="min-h-8 rounded-control px-2.5 font-mono text-[11px] font-medium text-accent-400 transition-colors duration-180 ease-out hover:bg-accent-dim"
            aria-label="Copy code to clipboard"
          >
            {isCopied ? "copied ✓" : "copy"}
          </button>
        </div>
      )}
      {!lang && (
        <button
          type="button"
          onClick={handleCopy}
          className="absolute right-2 top-2 min-h-8 rounded-control px-2.5 font-mono text-[11px] font-medium text-accent-400 transition-colors duration-180 ease-out hover:bg-accent-dim"
          aria-label="Copy code to clipboard"
        >
          {isCopied ? "copied ✓" : "copy"}
        </button>
      )}
      <pre
        className="overflow-x-auto p-4"
        tabIndex={0}
        aria-label={lang ? `${lang} code example` : "Code example"}
      >
        <code className="font-mono text-[13px] leading-[1.7] text-text-2">
          {isTerminal
            ? lines.map((line, i) => (
                <span key={i}>
                  {i > 0 && "\n"}
                  {renderLine(line)}
                </span>
              ))
            : code}
        </code>
      </pre>
      <span className="sr-only" aria-live="polite">
        {isCopied ? "Copied to clipboard." : copyError ? "Copy failed. Select the code manually." : ""}
      </span>
    </div>
  );
}
