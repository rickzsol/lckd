"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { TrustTier } from "@/types/index";

export interface RepoItem {
  full_name: string;
  name: string;
  description: string | null;
  stars: number;
  language: string | null;
}

export interface RepoCommit {
  sha: string;
  message: string;
  date: string | null;
}

export interface RepoActivity {
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  pushedAt: string;
  commits: RepoCommit[];
}

/** Fixture data source for /demo so the panel renders without a session. */
export interface DemoGitHubData {
  repos: RepoItem[];
  activity: Record<string, RepoActivity>;
}

export const DemoGitHubContext = createContext<DemoGitHubData | null>(null);

export function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const elapsedMs = Date.now() - new Date(dateStr).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

/** Render with key={repo} so state resets when the selection changes. */
export function RepoActivityCard({ repo }: { repo: string }) {
  const demo = useContext(DemoGitHubContext);
  const [fetched, setFetched] = useState<RepoActivity | null>(null);
  const [fetchState, setFetchState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (demo) return;
    let isActive = true;
    fetch(`/api/v1/github/activity?repo=${encodeURIComponent(repo)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Activity unavailable");
        return response.json();
      })
      .then((data: RepoActivity) => {
        if (!isActive) return;
        setFetched(data);
        setFetchState("ready");
      })
      .catch(() => {
        if (!isActive) return;
        setFetched(null);
        setFetchState("error");
      });
    return () => {
      isActive = false;
    };
  }, [repo, demo]);

  const activity = demo ? demo.activity[repo] ?? null : fetched;
  const state = demo ? (activity ? "ready" : "error") : fetchState;

  if (state === "loading") {
    return (
      <div className="mt-2.5 animate-pulse rounded-control border border-line-default bg-surface-deep p-4">
        <div className="h-3 w-2/3 rounded bg-surface-2" />
        <div className="mt-3 h-2.5 w-full rounded bg-surface-2" />
        <div className="mt-2 h-2.5 w-5/6 rounded bg-surface-2" />
      </div>
    );
  }

  if (state === "error" || !activity) {
    return (
      <p role="status" className="mt-2 font-mono text-[10px] text-text-4">
        Repository activity unavailable right now. The link still works.
      </p>
    );
  }

  return (
    <div className="mt-2.5 rounded-control border border-line-default bg-surface-deep p-4">
      {activity.description && (
        <p className="mb-3 text-[13px] leading-relaxed text-text-2">{activity.description}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] tabular-nums text-text-3">
        {activity.language && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {activity.language}
          </span>
        )}
        <span>{activity.stars} stars</span>
        <span>{activity.forks} forks</span>
        <span>pushed {relativeTime(activity.pushedAt)}</span>
      </div>

      {activity.commits.length > 0 && (
        <div className="mt-3.5 border-t border-line pt-3">
          <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
            Recent commits
          </div>
          <ul className="space-y-1.5">
            {activity.commits.map((commit) => (
              <li key={commit.sha} className="flex items-baseline gap-2.5">
                <code className="shrink-0 rounded-[6px] border border-accent/20 bg-accent-dim px-1.5 py-0.5 font-mono text-[10px] text-accent-400">
                  {commit.sha}
                </code>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-2">
                  {commit.message}
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-4">
                  {relativeTime(commit.date)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const TIER_STEPS = [
  { tier: TrustTier.LOCKED, label: "LOCKED" },
  { tier: TrustTier.VERIFIED, label: "VERIFIED" },
  { tier: TrustTier.BUILDER, label: "BUILDER" },
  { tier: TrustTier.SHIPPED, label: "SHIPPED" },
] as const;

export function TierLadder({
  tier,
  hasRepo,
  hasLive,
}: {
  tier: TrustTier;
  hasRepo: boolean;
  hasLive: boolean;
}) {
  const hint = !hasRepo
    ? "link a repository to reach BUILDER"
    : !hasLive
      ? "add a live URL to reach SHIPPED"
      : "highest profile tier for this launch";

  return (
    <div className="rounded-control border border-line-default bg-surface-deep p-3.5">
      <div className="mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
        Profile tier
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {TIER_STEPS.map((step) => {
          const isReached = step.tier <= tier;
          const isCurrent = step.tier === tier;
          return (
            <div
              key={step.label}
              aria-current={isCurrent ? "true" : undefined}
              className={`rounded-[6px] border px-1 py-1.5 text-center font-mono text-[9px] font-bold tracking-[0.08em] ${
                isCurrent
                  ? "border-accent/40 bg-accent-dim text-accent"
                  : isReached
                    ? "border-accent/15 bg-accent-dim/50 text-accent/50"
                    : "border-line-default bg-transparent text-text-4"
              }`}
            >
              {step.label}
            </div>
          );
        })}
      </div>
      <p className="mt-2 font-mono text-[10px] text-text-4">{hint}</p>
    </div>
  );
}
