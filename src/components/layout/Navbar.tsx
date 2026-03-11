"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import WalletMultiButton from "@/components/ui/WalletButton";

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
    <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-[rgba(8,8,8,0.92)] backdrop-blur-[12px]">
      <div className="flex w-full items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-[7px]">
          <Image
            src="/icon.png"
            alt="LCKD logo"
            width={28}
            height={28}
            className="rounded-md"
            priority
          />
          <span className="font-sans text-[15px] font-bold">
            LCK<span className="text-accent">D</span>
          </span>
        </Link>

        <div className="hidden items-center gap-5 md:flex">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-0 py-1 font-mono text-[11px] transition-colors hover:text-accent ${
                  isActive ? "text-accent" : "text-[#555]"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <span className="h-3.5 w-px bg-white/[0.08]" />
          <a
            href="https://x.com/lckdtechx"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#555] transition-colors hover:text-accent"
            aria-label="X (Twitter)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
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
          <div className="relative z-50 border-t border-white/[0.06] bg-[rgba(8,8,8,0.98)] px-4 pb-4 md:hidden">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMobileOpen(false)}
                  className={`block py-3 font-mono text-[11px] transition-colors hover:text-accent ${
                    isActive ? "text-accent" : "text-[#555]"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
            <div className="border-t border-white/[0.06] pt-3">
              <a
                href="https://x.com/lckdtechx"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#555] transition-colors hover:text-accent"
                aria-label="X (Twitter)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
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
