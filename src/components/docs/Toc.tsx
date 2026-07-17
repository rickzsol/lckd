"use client";

import { useState, useEffect } from "react";
import { flushSync } from "react-dom";

export interface TocSection {
  id: string;
  label: string;
}

export default function Toc({ sections }: { sections: TocSection[] }) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");
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

    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [sections]);

  const handleClick = (id: string) => {
    // Collapse the mobile dropdown before scrolling; it sits above the
    // target in the flow, so scrolling first overshoots by its height.
    flushSync(() => setIsOpen(false));
    const el = document.getElementById(id);
    if (el) {
      const isReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: isReduced ? "auto" : "smooth", block: "start" });
      window.history.replaceState(null, "", `#${id}`);
    }
  };

  const activeLabel = sections.find((s) => s.id === activeId)?.label ?? "";

  return (
    <>
      {/* Mobile dropdown */}
      <div className="sticky top-[84px] z-30 -mx-4 border-y border-line-default bg-surface/95 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex min-h-11 w-full items-center justify-between px-4 py-3 font-mono text-xs text-text-3"
          aria-expanded={isOpen}
          aria-controls="docs-mobile-toc"
        >
          <span className="truncate">{activeLabel}</span>
          <svg
            className={`h-3.5 w-3.5 shrink-0 transition-transform duration-180 ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isOpen && (
          <nav id="docs-mobile-toc" aria-label="On this page" className="border-t border-line px-4 pb-3">
            {sections.map(({ id, label }) => (
              <a
                key={id}
                href={`#${id}`}
                onClick={(event) => {
                  event.preventDefault();
                  handleClick(id);
                }}
                aria-current={id === activeId ? "location" : undefined}
                className={`flex min-h-11 w-full items-center text-left font-mono text-xs transition-colors duration-180 ease-out ${
                  id === activeId ? "text-accent-400" : "text-text-3 hover:text-accent-400"
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
        )}
      </div>

      {/* Desktop sidebar */}
      <nav aria-label="On this page" className="sticky top-20 hidden h-fit w-48 shrink-0 lg:block">
        <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3">
          On this page
        </p>
        <ul className="space-y-1 border-l border-line-default">
          {sections.map(({ id, label }) => (
            <li key={id}>
              <a
                href={`#${id}`}
                onClick={(event) => {
                  event.preventDefault();
                  handleClick(id);
                }}
                aria-current={id === activeId ? "location" : undefined}
                className={`flex min-h-10 w-full items-center pl-3 text-left font-mono text-xs transition-colors duration-180 ease-out ${
                  id === activeId
                    ? "border-l-2 border-accent-700 -ml-px text-accent-400"
                    : "text-text-3 hover:text-accent-400"
                }`}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
