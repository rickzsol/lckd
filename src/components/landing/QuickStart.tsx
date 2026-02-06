"use client";

import { useState, useCallback } from "react";

type Tab = "npx" | "npm" | "config";

const TABS: { key: Tab; label: string }[] = [
  { key: "npx", label: "One-liner" },
  { key: "npm", label: "npm" },
  { key: "config", label: "Config" },
];

interface LineProps {
  comment?: string;
  cmd: string;
  copyText: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy"
      className="shrink-0 opacity-0 transition-opacity group-hover/line:opacity-100"
    >
      {copied ? (
        <svg className="h-3.5 w-3.5 text-emerald-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5 text-[#555] hover:text-emerald-accent transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function CodeLine({ comment, cmd, copyText }: LineProps) {
  return (
    <>
      {comment && (
        <div className="px-4 font-mono text-[11px] text-[#444]">{comment}</div>
      )}
      <div className="group/line flex items-center gap-2 px-4">
        <span className="shrink-0 font-mono text-[11px] text-[#444]">$</span>
        <span className="min-w-0 flex-1 font-mono text-[12px] text-text-primary">
          {cmd}
        </span>
        <CopyButton text={copyText} />
      </div>
    </>
  );
}

const CONTENT: Record<Tab, LineProps[]> = {
  npx: [
    {
      comment: "# launch a token with locked dev allocation",
      cmd: "npx trudev launch",
      copyText: "npx trudev launch",
    },
  ],
  npm: [
    {
      comment: "# install globally",
      cmd: "npm i -g trudev",
      copyText: "npm i -g trudev",
    },
    {
      comment: "# interactive launch wizard",
      cmd: "trudev launch",
      copyText: "trudev launch",
    },
  ],
  config: [
    {
      comment: "# launch from config (CI/CD, bots)",
      cmd: "trudev launch --config trudev.json",
      copyText: "trudev launch --config trudev.json",
    },
    {
      comment: "# check lock status",
      cmd: "trudev status <mint-address>",
      copyText: "trudev status ",
    },
  ],
};

export default function QuickStart() {
  const [active, setActive] = useState<Tab>("npx");

  return (
    <div className="w-full max-w-[480px] overflow-hidden rounded-xl border border-white/[0.06] bg-[rgba(17,19,24,0.6)] backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-2.5">
        {/* Dots */}
        <div className="flex gap-1.5">
          <span className="h-[7px] w-[7px] rounded-full bg-white/[0.08]" />
          <span className="h-[7px] w-[7px] rounded-full bg-white/[0.08]" />
          <span className="h-[7px] w-[7px] rounded-full bg-white/[0.08]" />
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={`rounded-md px-2.5 py-1 font-mono text-[10px] font-medium transition-colors ${
                active === tab.key
                  ? "bg-emerald-accent/10 text-emerald-accent"
                  : "text-[#555] hover:text-[#888]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Code */}
      <div className="space-y-1.5 py-3.5">
        {CONTENT[active].map((line) => (
          <CodeLine key={line.cmd} {...line} />
        ))}
      </div>
    </div>
  );
}
