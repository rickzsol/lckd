"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton
    ),
  { ssr: false }
);

const NAV_LINKS = [
  { href: "/feed", label: "explore" },
  { href: "/launch", label: "launch" },
  { href: "/docs", label: "docs" },
  { href: "/api-docs", label: "api" },
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
    <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-[rgba(8,8,12,0.92)] backdrop-blur-[12px]">
      <div className="flex w-full items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-[7px]">
          <Image
            src="/icon-transparent.png"
            alt="trudev logo"
            width={26}
            height={26}
            className="rounded-md"
            priority
          />
          <span className="font-sans text-[15px] font-bold">
            tru<span className="text-emerald-accent">dev</span>
            <span className="text-[#555]">.fun</span>
          </span>
        </Link>

        <div className="hidden items-center gap-5 md:flex">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-0 py-1 font-mono text-[11px] transition-colors hover:text-emerald-accent ${
                  isActive ? "text-emerald-accent" : "text-[#555]"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <span className="h-3.5 w-px bg-white/[0.08]" />
          <div className="flex items-center gap-3">
            <a
              href="https://x.com/trudevfun"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#555] transition-colors hover:text-emerald-accent"
              aria-label="X (Twitter)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a
              href="https://discord.gg/X3bbWQzFyj"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#555] transition-colors hover:text-emerald-accent"
              aria-label="Discord"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
              </svg>
            </a>
          </div>
          {session?.github_username && (
            <Link
              href={`/dev/${session.github_username}`}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-white/[0.04]"
            >
              <Image
                src={`https://avatars.githubusercontent.com/${session.github_username}?s=40`}
                alt={session.github_username}
                width={20}
                height={20}
                className="rounded-full"
              />
              <span className="font-mono text-[10px] text-[#888]">
                {session.github_username}
              </span>
            </Link>
          )}
          <WalletMultiButton />
        </div>

        <button
          type="button"
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="flex flex-col gap-1.5 md:hidden"
          aria-label="Toggle menu"
          aria-expanded={isMobileOpen}
        >
          <span
            className={`h-0.5 w-5 bg-white/70 transition-all duration-200 ${isMobileOpen ? "translate-y-2 rotate-45" : ""}`}
          />
          <span
            className={`h-0.5 w-5 bg-white/70 transition-all duration-200 ${isMobileOpen ? "opacity-0" : ""}`}
          />
          <span
            className={`h-0.5 w-5 bg-white/70 transition-all duration-200 ${isMobileOpen ? "-translate-y-2 -rotate-45" : ""}`}
          />
        </button>
      </div>

      {isMobileOpen && (
        <>
          <div
            className="fixed inset-0 top-[49px] z-40 bg-black/50 md:hidden"
            onClick={() => setIsMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-50 border-t border-white/[0.06] bg-[rgba(8,8,12,0.98)] px-4 pb-4 md:hidden">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMobileOpen(false)}
                  className={`block py-3 font-mono text-[11px] transition-colors hover:text-emerald-accent ${
                    isActive ? "text-emerald-accent" : "text-[#555]"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
            <div className="flex items-center gap-4 border-t border-white/[0.06] pt-3">
              <a
                href="https://x.com/trudevfun"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#555] transition-colors hover:text-emerald-accent"
                aria-label="X (Twitter)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a
                href="https://discord.gg/X3bbWQzFyj"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#555] transition-colors hover:text-emerald-accent"
                aria-label="Discord"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
                </svg>
              </a>
            </div>
            {session?.github_username && (
              <Link
                href={`/dev/${session.github_username}`}
                onClick={() => setIsMobileOpen(false)}
                className="flex items-center gap-2 border-t border-white/[0.06] py-3"
              >
                <Image
                  src={`https://avatars.githubusercontent.com/${session.github_username}?s=40`}
                  alt={session.github_username}
                  width={20}
                  height={20}
                  className="rounded-full"
                />
                <span className="font-mono text-[11px] text-[#888]">
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
