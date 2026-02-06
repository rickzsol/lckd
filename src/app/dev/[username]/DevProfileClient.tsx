"use client";

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useWallet } from "@solana/wallet-adapter-react";
import Image from "next/image";
import Link from "next/link";
import Badge from "@/components/ui/Badge";
import Bar from "@/components/ui/Bar";
import CommitGraph from "@/components/ui/CommitGraph";
import { useClaimFees } from "@/hooks/useClaimFees";
import { TrustTier } from "@/types/index";
import type { GitHubProfile, ContributionDay } from "@/types/index";
import type { DisplayToken } from "@/types/display";

type Tab = "launches" | "github" | "settings";

const TIER_LABELS: Record<TrustTier, string> = {
  [TrustTier.LOCKED]: "LOCKED",
  [TrustTier.VERIFIED]: "VERIFIED",
  [TrustTier.BUILDER]: "BUILDER",
  [TrustTier.SHIPPED]: "SHIPPED",
};

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

function getAccountAge(createdAt: string): string {
  const diff = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  const years = Math.floor(days / 365);
  const remainingMonths = Math.floor((days % 365) / 30);
  return remainingMonths > 0 ? `${years}y ${remainingMonths}mo` : `${years}y`;
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
    <div className="mx-auto max-w-[800px] p-4 pt-8">
      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/[0.08]">
          {avatar.startsWith("http") || avatar.startsWith("/") ? (
            <Image
              src={avatar}
              alt={profile.github_username}
              width={64}
              height={64}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-emerald-accent/[0.06] font-mono text-lg font-bold text-emerald-accent">
              {profile.github_username.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-sans text-xl font-bold text-white">
              @{profile.github_username}
            </h1>
            <Badge tier={tier} label={TIER_LABELS[tier]} />
          </div>

          {bio && (
            <p className="mt-1 font-mono text-xs text-[#888]">{bio}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[10px] text-[#555]">
            {profile.wallet_address && (
              <span className="rounded bg-white/[0.04] px-1.5 py-0.5">
                {truncateAddress(profile.wallet_address)}
              </span>
            )}
            <span>{accountAge} on GitHub</span>
            <span>{repos} repos</span>
            <span>{tokens.length} launches</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-white/[0.06] pb-px">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-wide transition-colors ${
              activeTab === tab
                ? "border-b-2 border-emerald-accent text-emerald-accent"
                : "text-[#555] hover:text-[#888]"
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
          githubData={githubData}
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
        <div className="font-mono text-[48px] text-white/10">{"{ }"}</div>
        <p className="mt-3 font-mono text-sm text-[#555]">
          No tokens launched yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {tokens.map((t) => {
        const href = t.mintAddress
          ? `/token/${t.mintAddress}`
          : `/token/${t.id}`;
        const isImageUrl =
          typeof t.image === "string" &&
          (t.image.startsWith("http") || t.image.startsWith("/"));

        return (
          <Link key={t.id} href={href} className="token-card block">
            <div className="mb-2 flex items-center gap-2.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-emerald-accent/20 bg-emerald-accent/[0.06]">
                {isImageUrl ? (
                  <Image
                    src={t.image}
                    alt={t.name}
                    width={48}
                    height={48}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="font-mono text-xs font-bold text-emerald-accent">
                    {t.image}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-[5px]">
                  <span className="font-sans text-sm font-bold text-white">
                    {t.name}
                  </span>
                  <span className="font-mono text-[11px] text-[#555]">
                    {t.ticker}
                  </span>
                  <Badge tier={t.tier} label={t.tierLabel} />
                </div>
                <div className="font-mono text-[10px] text-[#444]">
                  LOCKED {t.lock.amount} {"\u00B7"} {t.lock.duration}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-[13px] font-bold text-[#e5e5e5]">
                  {t.mcap}
                </div>
              </div>
            </div>
            <div className="flex items-center font-mono text-[10px] text-[#888]">
              <span className="mr-1.5">
                {t.lock.start} {"\u2192"} {t.lock.end}
              </span>
              <div className="min-w-[40px] flex-1">
                <Bar pct={t.lock.pct} />
              </div>
              <span className="ml-1.5 text-[#555]">{100 - t.lock.pct}%</span>
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
  githubData,
  contributions,
  repos,
  accountAge,
}: {
  profile: GitHubProfile;
  githubData: GitHubData | null;
  contributions: ContributionDay[];
  repos: number;
  accountAge: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.04]">
        <StatCell label="Repos" value={String(repos)} />
        <StatCell label="Commits" value={String(profile.total_commits)} />
        <StatCell label="Account Age" value={accountAge} />
      </div>

      {/* Contribution graph */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
        <h3 className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-wide text-[#555]">
          Recent Activity
        </h3>
        {contributions.length > 0 ? (
          <ContributionGraph contributions={contributions} />
        ) : (
          <CommitGraph />
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
    <div className="bg-dark-bg px-4 py-3 text-center">
      <div className="font-mono text-lg font-bold text-white">{value}</div>
      <div className="font-mono text-[10px] text-[#555]">{label}</div>
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
    <div className="flex gap-[2px] overflow-hidden">
      {contributions.map((day) => {
        const intensity = day.count / maxCount;
        const bg =
          intensity > 0.7
            ? "#10b981"
            : intensity > 0.4
              ? "#065f46"
              : intensity > 0
                ? "#064e3b"
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
      <FeeClaimSection profile={profile} />
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
      const message = `Link wallet to trudev.fun\nUsername: ${profile.github_username}\nTimestamp: ${ts}`;
      const msgBytes = new TextEncoder().encode(message);
      const sigBytes = await signMessage(msgBytes);
      const signature = Buffer.from(sigBytes).toString("base64");

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
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <h3 className="mb-1 font-sans text-sm font-bold text-white">
        Wallet
      </h3>
      <p className="mb-3 font-mono text-[10px] text-[#555]">
        Link your Solana wallet to claim creator fees and verify ownership.
      </p>

      {linkedAddress ? (
        <div className="flex items-center gap-2">
          <span className="rounded bg-emerald-accent/[0.08] px-2 py-1 font-mono text-[11px] text-emerald-accent">
            {truncateAddress(linkedAddress)}
          </span>
          {linkSuccess && (
            <span className="font-mono text-[10px] text-emerald-accent">
              Linked!
            </span>
          )}
        </div>
      ) : connected && publicKey ? (
        <button
          onClick={handleLinkWallet}
          disabled={isLinking}
          className="btn-primary px-4 py-2 text-[11px]"
        >
          {isLinking ? "Signing..." : "Link Wallet"}
        </button>
      ) : (
        <p className="font-mono text-[11px] text-[#555]">
          Connect your wallet first using the button in the navbar.
        </p>
      )}

      {linkError && (
        <p className="mt-2 font-mono text-[10px] text-red-400">{linkError}</p>
      )}
    </div>
  );
}

function FeeClaimSection({ profile }: { profile: GitHubProfile }) {
  const { connected } = useWallet();
  const { claimFees, isLoading, error, txSignature } = useClaimFees();

  const hasWallet = !!profile.wallet_address;

  if (!hasWallet) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
        <h3 className="mb-1 font-sans text-sm font-bold text-white">
          Claim Creator Fees
        </h3>
        <p className="font-mono text-[10px] text-[#555]">
          Link your wallet first to claim accumulated creator fees from PumpPortal.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <h3 className="mb-1 font-sans text-sm font-bold text-white">
        Claim Creator Fees
      </h3>
      <p className="mb-3 font-mono text-[10px] text-[#555]">
        Collect accumulated creator fees from Pump.fun / Meteora.
      </p>

      {connected ? (
        <button
          onClick={claimFees}
          disabled={isLoading}
          className="btn-primary px-4 py-2 text-[11px]"
        >
          {isLoading ? "Claiming..." : "Claim Fees"}
        </button>
      ) : (
        <p className="font-mono text-[11px] text-[#555]">
          Connect your wallet to claim fees.
        </p>
      )}

      {txSignature && (
        <div className="mt-2">
          <a
            href={`https://solscan.io/tx/${txSignature}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[10px] text-emerald-accent underline underline-offset-2"
          >
            View transaction {"\u2192"}
          </a>
        </div>
      )}

      {error && (
        <p className="mt-2 font-mono text-[10px] text-red-400">{error}</p>
      )}
    </div>
  );
}
