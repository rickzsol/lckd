"use client";

import { useState, useEffect } from "react";

interface TocSection {
  id: string;
  label: string;
}

const SECTIONS: TocSection[] = [
  { id: "quick-start", label: "Quick Start" },
  { id: "overview", label: "Overview" },
  { id: "cli", label: "CLI" },
  { id: "config-file", label: "Config File" },
  { id: "post-launch", label: "POST /launch" },
  { id: "post-metadata-upload", label: "POST /metadata/upload" },
  { id: "get-token", label: "GET /token/:ca" },
  { id: "get-token-lock", label: "GET /token/:ca/lock" },
  { id: "get-dev", label: "GET /dev/:username" },
  { id: "post-verify-dex", label: "POST /verify-dex" },
  { id: "get-feed", label: "GET /feed" },
  { id: "integration-examples", label: "Integration Examples" },
];

export default function ApiToc() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 },
    );

    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const handleClick = (id: string) => {
    setIsOpen(false);
    const el = document.getElementById(id);
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  const activeLabel = SECTIONS.find((s) => s.id === activeId)?.label ?? "";

  return (
    <>
      <div className="sticky top-[49px] z-30 border-b border-white/[0.06] bg-[rgba(8,8,12,0.95)] backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex w-full items-center justify-between px-4 py-3 font-mono text-xs text-text-muted"
        >
          <span className="truncate">{activeLabel}</span>
          <svg
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isOpen && (
          <div className="border-t border-white/[0.04] px-4 pb-3">
            {SECTIONS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleClick(id)}
                className={`block w-full py-2 text-left font-mono text-xs transition-colors ${
                  id === activeId
                    ? "text-emerald-accent"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <nav className="sticky top-[89px] hidden h-fit w-48 shrink-0 lg:block">
        <p className="mb-3 font-mono text-[9px] font-bold uppercase tracking-wider text-text-muted">
          On this page
        </p>
        <ul className="space-y-1 border-l border-white/[0.06]">
          {SECTIONS.map(({ id, label }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => handleClick(id)}
                className={`block w-full py-1 pl-3 text-left font-mono text-[11px] transition-colors ${
                  id === activeId
                    ? "border-l-2 border-emerald-accent -ml-px text-emerald-accent"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
