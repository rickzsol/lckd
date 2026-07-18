"use client";

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useWallet } from "@solana/wallet-adapter-react";
import Image from "next/image";
import Link from "next/link";
import Badge, { getTrustBadgeLabel, getTrustTierBadgeLabel } from "@/components/ui/Badge";
import Bar from "@/components/ui/Bar";
import TokenImage from "@/components/ui/TokenImage";
import { getAccountAge } from "@/lib/accountAge";
import { TrustTier } from "@/types/index";
import type { GitHubProfile, ContributionDay } from "@/types/index";
import type { DisplayToken } from "@/types/display";

type Tab = "launches" | "github" | "settings";

interface GitHubData {
  github_username: string;
  github_avatar: string;
  account_created_at: string;
  public_repos: number;
  bio: string | null;
}

interface Props {
  profile: GitHubProfile;
  tokens: DisplayToken[];
  githubData: GitHubData | null;
  contributions: ContributionDay[];
}

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function getHighestTier(tokens: DisplayToken[]): TrustTier {
  if (tokens.length === 0) return TrustTier.LOCKED;
  return Math.max(...tokens.map((t) => t.tier)) as TrustTier;
}

export default function DevProfileClient({
  profile,
  tokens,
  githubData,
  contributions,
}: Props) {
  const { data: session } = useSession();
  const isOwnProfile = session?.github_username === profile.github_username;
  const [activeTab, setActiveTab] = useState<Tab>("launches");

  const tier = getHighestTier(tokens);
  const accountAge = getAccountAge(profile.account_created_at);
  const avatar = githubData?.github_avatar || profile.github_avatar;
  const bio = githubData?.bio;
  const repos = githubData?.public_repos ?? profile.public_repos;

  const tabs: Tab[] = isOwnProfile
    ? ["launches", "github", "settings"]
    : ["launches", "github"];

  return (
    <div className="mx-auto max-w-[800px] px-4 pt-28 pb-16">
      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-card border border-line-default">
          {avatar.startsWith("http") || avatar.startsWith("/") ? (
            <Image
              src={avatar}
              alt={profile.github_username}
              width={64}
              height={64}
              loading="eager"
              fetchPriority="high"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-accent-dim font-mono text-lg font-bold text-accent">
              {profile.github_username.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-sans text-xl font-bold tracking-[-0.01em] text-text-1">
              @{profile.github_username}
            </h1>
            <Badge tier={tier} label={getTrustTierBadgeLabel(tier)} />
          </div>

          {bio && (
            <p className="mt-1 font-mono text-xs text-text-2">{bio}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[10px] text-text-3">
            {profile.wallet_address && (
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 tabular-nums">
                {truncateAddress(profile.wallet_address)}
              </span>
            )}
            <span className="tabular-nums">{accountAge} on GitHub</span>
            <span className="tabular-nums">{repos} repos</span>
            <span className="tabular-nums">{tokens.length} launches</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-line pb-px" role="tablist" aria-label="Developer profile sections">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`min-h-11 px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-wide transition-colors duration-[180ms] ${
              activeTab === tab
                ? "border-b-2 border-accent text-accent"
                : "text-text-3 hover:text-text-2"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "launches" && (
        <LaunchesTab tokens={tokens} />
      )}
      {activeTab === "github" && (
        <GitHubTab
          profile={profile}
          contributions={contributions}
          repos={repos}
          accountAge={accountAge}
        />
      )}
      {activeTab === "settings" && isOwnProfile && (
        <SettingsTab profile={profile} />
      )}
    </div>
  );
}

/* ─── Launches Tab ──────────────────────────────────── */

function LaunchesTab({ tokens }: { tokens: DisplayToken[] }) {
  if (tokens.length === 0) {
    return (
      <div className="flex flex-col items-center py-16">
        <div className="font-mono text-[48px] text-line-strong">{"{ }"}</div>
        <p className="mt-3 font-mono text-sm text-text-3">
          No tokens launched yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {tokens.map((t, index) => {
        const href = t.mintAddress
          ? `/token/${t.mintAddress}`
          : `/token/${t.id}`;
        const hasLockRecord =
          t.lock.amount !== "--" &&
          t.lock.amount !== "0" &&
          t.lock.duration !== "--";

        return (
          <Link key={t.id} href={href} className="token-card block">
            <div className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-control border border-accent/20 bg-accent-dim">
                <TokenImage
                  src={t.image}
                  alt={t.name}
                  size={48}
                  quality={60}
                  isEager={index < 4}
                />
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate font-sans text-[15px] font-bold text-text-1">
                    {t.name}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-text-3">
                    {t.ticker}
                  </span>
                </div>
                <div className="mt-1">
                  <Badge tier={t.tier} label={getTrustBadgeLabel(t.tierLabel)} />
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-[8px] font-semibold uppercase tracking-[0.12em] text-text-4">
                  Market cap
                </div>
                <div className="font-mono text-sm font-bold tabular-nums text-text-1">
                  {t.mcap}
                </div>
              </div>
            </div>

            <div className="mt-3 border-t border-line pt-3">
              <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
                <span className="font-semibold uppercase tracking-[0.12em] text-text-4">
                  Lock receipt
                </span>
                <span className="text-right font-semibold text-text-2 tabular-nums">
                  {hasLockRecord ? `${t.lock.amount} · ${t.lock.duration}` : "Unavailable"}
                </span>
              </div>
              {hasLockRecord && (
                <>
                  <div className="mt-2">
                    <Bar pct={t.lock.pct} />
                  </div>
                  <div className="mt-2 text-right font-mono text-[9px] text-text-3 tabular-nums">
                    {t.lock.pct >= 100
                      ? `Lock term complete · unlocked ${t.lock.end}`
                      : `${t.lock.pct}% of lock term elapsed · unlocks ${t.lock.end}`}
                  </div>
                </>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/* ─── GitHub Tab ────────────────────────────────────── */

function GitHubTab({
  profile,
  contributions,
  repos,
  accountAge,
}: {
  profile: GitHubProfile;
  contributions: ContributionDay[];
  repos: number;
  accountAge: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line-default bg-line-default">
        <StatCell label="Repos" value={String(repos)} />
        <StatCell label="Account Age" value={accountAge} />
      </div>

      {/* Contribution graph */}
      <div className="rounded-card border border-line-default bg-surface p-4">
        <h3 className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-wide text-text-3">
          Recent Activity
        </h3>
        {contributions.length > 0 ? (
          <ContributionGraph contributions={contributions} />
        ) : (
          <p role="status" className="font-mono text-xs text-text-3">Contribution data unavailable.</p>
        )}
      </div>

      {/* GitHub link */}
      <a
        href={`https://github.com/${profile.github_username}`}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-secondary self-start"
      >
        View on GitHub {"\u2192"}
      </a>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-deep px-4 py-3 text-center">
      <div className="font-mono text-lg font-bold tabular-nums text-text-1">{value}</div>
      <div className="font-mono text-[10px] text-text-3">{label}</div>
    </div>
  );
}

function ContributionGraph({
  contributions,
}: {
  contributions: ContributionDay[];
}) {
  const maxCount = Math.max(...contributions.map((c) => c.count), 1);

  return (
    <div className="flex gap-[2px] overflow-hidden" role="img" aria-label="Recent GitHub contribution activity">
      {contributions.map((day) => {
        const intensity = day.count / maxCount;
        const bg =
          intensity > 0.7
            ? "#2BD17E"
            : intensity > 0.4
              ? "#1FB368"
              : intensity > 0
                ? "#178A52"
                : "rgba(255,255,255,0.03)";
        return (
          <div
            key={day.date}
            className="h-[6px] w-[6px] rounded-[1px]"
            style={{ background: bg }}
            title={`${day.date}: ${day.count} contributions`}
          />
        );
      })}
    </div>
  );
}

/* ─── Settings Tab ──────────────────────────────────── */

function SettingsTab({ profile }: { profile: GitHubProfile }) {
  return (
    <div className="flex flex-col gap-6">
      <WalletLinkSection profile={profile} />
    </div>
  );
}

function WalletLinkSection({ profile }: { profile: GitHubProfile }) {
  const { publicKey, signMessage, connected } = useWallet();
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState(false);
  const [linkedAddress, setLinkedAddress] = useState(profile.wallet_address);

  const handleLinkWallet = useCallback(async () => {
    if (!publicKey || !signMessage) return;

    setIsLinking(true);
    setLinkError(null);

    try {
      const ts = Date.now();
      const message = `Link wallet to lckd.tech\nUsername: ${profile.github_username}\nTimestamp: ${ts}`;
      const msgBytes = new TextEncoder().encode(message);
      const sigBytes = await signMessage(msgBytes);
      const signature = btoa(String.fromCharCode(...sigBytes));

      const res = await fetch("/api/profile/link-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          signature,
          message,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to link wallet");
      }

      setLinkSuccess(true);
      setLinkedAddress(publicKey.toBase58());
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "Failed to link wallet");
    } finally {
      setIsLinking(false);
    }
  }, [publicKey, signMessage, profile.github_username]);

  return (
    <div className="rounded-card border border-line-default bg-surface p-4">
      <h3 className="mb-1 font-sans text-sm font-bold text-text-1">
        Wallet
      </h3>
      <p className="mb-3 font-mono text-[10px] text-text-3">
        Link your Solana wallet to verify ownership before launching.
      </p>

      {linkedAddress ? (
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-accent-dim px-2 py-1 font-mono text-[11px] tabular-nums text-accent">
            {truncateAddress(linkedAddress)}
          </span>
          {linkSuccess && (
            <span className="font-mono text-[10px] text-accent">
              Linked!
            </span>
          )}
        </div>
      ) : connected && publicKey ? (
        <button
          type="button"
          onClick={handleLinkWallet}
          disabled={isLinking}
          className="btn-primary px-4 py-2 text-[11px]"
        >
          {isLinking ? "Signing..." : "Link Wallet"}
        </button>
      ) : (
        <p className="font-mono text-[11px] text-text-3">
          Connect your wallet first using the button in the navbar.
        </p>
      )}

      {linkError && (
        <p role="alert" className="mt-2 font-mono text-[10px] text-danger">{linkError}</p>
      )}
    </div>
  );
}
