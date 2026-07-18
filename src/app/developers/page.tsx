import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import Badge, { getTrustTierBadgeLabel } from "@/components/ui/Badge";
import { getVerifiedDevelopers } from "@/lib/profile";
import { getAccountAge } from "@/lib/accountAge";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Developers",
  description:
    "Developers linked to recorded LCKD launch and lock receipts.",
  alternates: { canonical: "/developers" },
  openGraph: {
    title: "Developers | LCKD",
    description: "Developers behind verified LCKD launches.",
    url: "/developers",
  },
};

export default async function DevelopersPage() {
  const developers = await getVerifiedDevelopers();

  return (
    <div className="mx-auto max-w-[1152px] px-4 pt-28 pb-16 sm:px-6">
      <div className="mb-6">
        <h1 className="font-sans text-[clamp(28px,6vw,40px)] font-bold tracking-[-0.02em] text-text-1">
          Developer directory
        </h1>
        <p className="mt-2 max-w-2xl font-sans text-[15px] leading-[1.6] text-text-2">
          Builders linked to recorded launch and lock receipts. Review each public GitHub account independently.
        </p>
      </div>

      <div className="mb-5 flex items-center justify-between border-y border-line py-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-text-3">
          Launch-linked profiles
        </p>
        <p className="font-mono text-[11px] text-text-3 tabular-nums">
          {developers.length} {developers.length === 1 ? "developer" : "developers"}
        </p>
      </div>

      {developers.length === 0 ? (
        <div className="flex flex-col items-center py-16">
          <div className="font-mono text-[48px] text-text-4">{"{ }"}</div>
          <p className="mt-3 font-mono text-sm text-text-3">
            No verified developer profiles are available.
          </p>
          <Link href="/launch" className="btn-primary mt-4">
            open launch wizard &rarr;
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {developers.map((d, index) => (
            <Link key={d.username} href={`/dev/${d.username}`} className="token-card block">
              <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3">
                <Image
                  src={d.avatar ?? `https://avatars.githubusercontent.com/${d.username}?size=80`}
                  alt=""
                  width={44}
                  height={44}
                  quality={60}
                  loading={index < 4 ? "eager" : "lazy"}
                  fetchPriority={index < 4 ? "high" : "auto"}
                  className="h-11 w-11 rounded-full border border-accent/30 bg-accent-dim object-cover"
                />
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm font-bold text-text-1">
                    @{d.username}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-text-3 tabular-nums">
                    {[
                      d.accountCreatedAt ? `${getAccountAge(d.accountCreatedAt)} on GitHub` : null,
                      d.publicRepos !== null ? `${d.publicRepos} repos` : null,
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-lg font-bold leading-none text-text-1 tabular-nums">
                    {d.launchCount}
                  </div>
                  <div className="mt-1 font-mono text-[8px] font-semibold uppercase tracking-[0.12em] text-text-4">
                    {d.launchCount === 1 ? "Launch" : "Launches"}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex min-w-0 items-center justify-between gap-3 border-t border-line pt-2.5">
                <Badge tier={d.highestTier} label={getTrustTierBadgeLabel(d.highestTier)} />
                <span className="min-w-0 truncate text-right font-mono text-[10px] text-text-3">
                  {d.tickers.join(" ")}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
