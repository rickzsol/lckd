"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import WalletMultiButton from "@/components/ui/WalletButton";

const NAV_LINKS = [
  { href: "/feed", label: "Explore" },
  { href: "/developers", label: "Developers" },
  { href: "/docs", label: "Docs", hideOnMobile: true },
  { href: "/api-docs", label: "API", hideOnMobile: true },
] as const;

export default function Navbar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    if (isMobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileOpen]);

  return (
    <nav aria-label="Primary" className="fixed inset-x-0 top-0 z-50 px-[10px] pt-[10px]">
      <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center justify-between rounded-[14px] border border-white/6 bg-[rgba(9,11,10,0.92)] pr-3 pl-[22px] backdrop-blur-[14px]">
        <Link href="/" className="focus-ring flex min-h-11 items-center rounded-md" aria-label="LCKD home">
          <span className="font-sans text-[18px] font-bold text-text-1">
            LCK<span className="text-accent">D</span>
          </span>
        </Link>

        <div className="flex items-center gap-4 sm:gap-6">
          <div className="hidden items-center gap-5 md:flex lg:gap-7">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`focus-ring hidden min-h-11 items-center font-sans text-[15px] font-medium transition-colors hover:text-text-1 md:inline-flex ${
                    "hideOnMobile" in link && link.hideOnMobile ? "hidden lg:inline-flex" : ""
                  } ${isActive ? "text-text-1" : "text-[#B8C2BC]"}`}
                >
                  {link.label}
                </Link>
              );
            })}
            <a
              href="https://x.com/launchlckd"
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring hidden h-11 items-center justify-center text-[#B8C2BC] transition-colors hover:text-text-1 lg:flex"
              aria-label="X (Twitter)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a
              href="https://github.com/rickzsol/lckd"
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring hidden h-11 items-center justify-center text-[#B8C2BC] transition-colors hover:text-text-1 lg:flex"
              aria-label="GitHub"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.53-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12v3.14c0 .3.21.66.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
              </svg>
            </a>
            <a
              href="https://discord.gg/r7bCZ575Cb"
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring hidden h-11 items-center justify-center text-[#B8C2BC] transition-colors hover:text-text-1 lg:flex"
              aria-label="Discord"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
            </a>
            {session?.github_username && (
              <Link
                href={`/dev/${session.github_username}`}
                className="focus-ring flex min-h-11 items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-white/[0.04]"
              >
                <Image
                  src={`https://avatars.githubusercontent.com/${session.github_username}?s=40`}
                  alt={session.github_username}
                  width={20}
                  height={20}
                  className="rounded-full"
                />
                <span className="font-mono text-[10px] text-text-3">
                  {session.github_username}
                </span>
              </Link>
            )}
          </div>
          <Link href="/launch" className="btn-primary hidden md:inline-flex">
            launch token
          </Link>
          <div className="hidden md:block">
            <WalletMultiButton />
          </div>

          <button
            type="button"
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            className="focus-ring flex h-11 w-11 flex-col items-center justify-center gap-1.5 rounded-md md:hidden"
            aria-label={isMobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={isMobileOpen}
            aria-controls="mobile-navigation"
          >
            <span
              className={`h-0.5 w-5 bg-text-1/70 transition-all duration-200 ${isMobileOpen ? "translate-y-2 rotate-45" : ""}`}
            />
            <span
              className={`h-0.5 w-5 bg-text-1/70 transition-all duration-200 ${isMobileOpen ? "opacity-0" : ""}`}
            />
            <span
              className={`h-0.5 w-5 bg-text-1/70 transition-all duration-200 ${isMobileOpen ? "-translate-y-2 -rotate-45" : ""}`}
            />
          </button>
        </div>
      </div>

      {isMobileOpen && (
        <>
          <div
            className="fixed inset-0 top-[74px] z-40 bg-black/50 md:hidden"
            onClick={() => setIsMobileOpen(false)}
            aria-hidden="true"
          />
          <div
            id="mobile-navigation"
            className="relative z-50 mx-auto mt-2 w-full max-w-[1400px] rounded-[14px] border border-white/6 bg-[rgba(9,11,10,0.92)] px-4 pb-4 backdrop-blur-[14px] md:hidden"
          >
            <Link
              href="/launch"
              onClick={() => setIsMobileOpen(false)}
              className="btn-primary mt-4 w-full"
            >
              launch token
            </Link>
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMobileOpen(false)}
                  aria-current={isActive ? "page" : undefined}
                  className={`focus-ring flex min-h-11 items-center rounded-md px-2 font-sans text-[15px] font-medium transition-colors hover:text-text-1 ${
                    isActive ? "text-text-1" : "text-[#B8C2BC]"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
            <div className="flex items-center gap-1 border-t border-line pt-3">
              <a
                href="https://x.com/launchlckd"
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring flex h-11 w-11 items-center justify-center text-[#B8C2BC] transition-colors hover:text-text-1"
                aria-label="X (Twitter)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a
                href="https://github.com/rickzsol/lckd"
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring flex h-11 w-11 items-center justify-center text-[#B8C2BC] transition-colors hover:text-text-1"
                aria-label="GitHub"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.53-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12v3.14c0 .3.21.66.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
                </svg>
              </a>
              <a
                href="https://discord.gg/r7bCZ575Cb"
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring flex h-11 w-11 items-center justify-center text-[#B8C2BC] transition-colors hover:text-text-1"
                aria-label="Discord"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
              </a>
            </div>
            {session?.github_username && (
              <Link
                href={`/dev/${session.github_username}`}
                onClick={() => setIsMobileOpen(false)}
                className="focus-ring flex min-h-11 items-center gap-2 border-t border-line px-2"
              >
                <Image
                  src={`https://avatars.githubusercontent.com/${session.github_username}?s=40`}
                  alt={session.github_username}
                  width={20}
                  height={20}
                  className="rounded-full"
                />
                <span className="font-mono text-[11px] text-text-3">
                  {session.github_username}
                </span>
              </Link>
            )}
            <div className="pt-2">
              <WalletMultiButton />
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
