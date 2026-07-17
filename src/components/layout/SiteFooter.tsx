"use client";

import { usePathname } from "next/navigation";

export default function SiteFooter() {
  const pathname = usePathname();
  if (pathname === "/coming-soon") return null;

  return (
    <footer className="relative z-[1] border-t border-line">
      <div className="mx-auto flex max-w-[1152px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-[22px] font-mono text-[11px] font-medium text-text-3 sm:px-6">
        <span className="flex items-center gap-2.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent">
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#041710"
              strokeWidth="2.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <rect x="4" y="11" width="16" height="10" rx="2.5" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <span>&copy; 2026 LCKD &middot; lckd.tech</span>
        </span>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-5">
          <a href="/docs" className="footer-link">docs</a>
          <a href="/api-docs" className="footer-link">api</a>
          <a href="/risk" className="footer-link">risk</a>
          <a
            href="https://github.com/rickzsol/lckd"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
          >
            github
          </a>
          <a
            href="https://x.com/launchlckd"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
          >
            @launchlckd
          </a>
        </nav>
      </div>
      <div className="mx-auto max-w-[1152px] px-4 pb-5 font-mono text-[10px] text-text-4 sm:px-6">
        LCKD provides launch tooling and public records, not investment advice.
      </div>
    </footer>
  );
}
