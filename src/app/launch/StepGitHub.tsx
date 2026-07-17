"use client";

import { useSession, signIn } from "next-auth/react";
import { useContext, useState, useEffect } from "react";
import Image from "next/image";
import type { WizardContext } from "@/hooks/useLaunchWizard";
import ContributionGraph from "@/components/github/ContributionGraph";
import {
  DemoGitHubContext,
  RepoActivityCard,
  TierLadder,
  type RepoItem,
} from "./githubProof";

function RepoSelector({
  username,
  value,
  onChange,
}: {
  username: string;
  value: string | null;
  onChange: (val: string | null) => void;
}) {
  const demo = useContext(DemoGitHubContext);
  const [repos, setRepos] = useState<RepoItem[]>(demo?.repos ?? []);
  const [isLoading, setIsLoading] = useState(!demo);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (demo || !username) return;
    fetch(`/api/v1/github/repos?username=${encodeURIComponent(username)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Repository list unavailable");
        return response.json();
      })
      .then((data: RepoItem[]) => setRepos(data))
      .catch(() => {
        setRepos([]);
        setError("Repository list unavailable. You can continue without linking one.");
      })
      .finally(() => setIsLoading(false));
  }, [username, demo]);

  return (
    <div>
      <select
        id="github-repo"
        className="form-input"
        value={value ?? ""}
        disabled={isLoading}
        aria-describedby={error ? "github-repo-error github-repo-help" : "github-repo-help"}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">{isLoading ? "Loading repositories..." : "No repository linked"}</option>
        {repos.map((repo) => (
          <option key={repo.full_name} value={repo.full_name}>
            {repo.name}{repo.language ? ` (${repo.language})` : ""}{repo.stars ? `, ${repo.stars} stars` : ""}
          </option>
        ))}
      </select>
      {error && <p id="github-repo-error" role="status" className="mt-1 font-mono text-[10px] text-warn">{error}</p>}
    </div>
  );
}

export default function StepGitHub({ w }: { w: WizardContext }) {
  const { data: session } = useSession();
  const isLinked = !!session?.github_username;
  const username = w.config.githubUsername ?? session?.github_username ?? null;

  const handleConnect = () => {
    if (isLinked) {
      w.updateConfig("githubUsername", session.github_username);
    } else {
      signIn("github", { callbackUrl: "/launch" });
    }
  };

  // Sync session to config when already linked
  useEffect(() => {
    if (isLinked && !w.config.githubUsername) {
      w.updateConfig("githubUsername", session.github_username);
    }
  }, [isLinked, w, session?.github_username]);

  return (
    <div>
      <h2 className="mb-5 font-mono text-[13px] font-bold text-accent">
        03 / Project links
      </h2>
      <p className="mb-5 font-mono text-[11px] leading-relaxed text-text-3">
        Your GitHub account authenticated this session. Repository and live product links
        are optional profile claims and are not audited by LCKD.
      </p>

      {!username ? (
        <div className="flex flex-col gap-4">
          <button
            onClick={handleConnect}
            className="btn-secondary w-full py-3.5 text-sm font-semibold"
          >
            <svg
              className="mr-1.5 inline h-4 w-4"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            sign in with github
          </button>

          <TierLadder tier={w.computedTier} hasRepo={false} hasLive={false} />

          <button
            onClick={w.goNext}
            className="w-full text-center font-mono text-[11px] text-text-4 underline underline-offset-[3px] transition-colors duration-[180ms] hover:text-text-3"
          >
            continue without profile links
          </button>

          <div className="mt-1 flex gap-2.5">
            <button onClick={w.goBack} className="btn-secondary flex-1 py-3">
              &larr; back
            </button>
          </div>
        </div>
      ) : (
        <div>
          {/* GitHub identity card */}
          <div className="mb-4 flex items-center gap-3 rounded-control border border-accent/20 bg-accent-dim px-3.5 py-3">
            <Image
              src={`https://github.com/${username}.png?size=80`}
              alt=""
              width={40}
              height={40}
              unoptimized
              className="h-10 w-10 shrink-0 rounded-full border border-accent/30 bg-surface-deep object-cover"
            />
            <div className="min-w-0 flex-1">
              <a
                href={`https://github.com/${username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs font-bold text-accent hover:underline"
              >
                @{username}
              </a>
              <div className="mt-0.5 font-mono text-[10px] text-text-3">
                authenticated this session
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent/25 bg-accent-dim px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-accent-400">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              connected
            </span>
          </div>

          {/* Contribution heatmap */}
          <div className="mb-4 rounded-control border border-line-default bg-surface-deep px-4 pb-3 pt-1">
            <ContributionGraph username={username} />
          </div>

          {/* Repo selector + live activity proof */}
          <div className="mb-4">
            <label htmlFor="github-repo" className="form-label">
              Link a Repository (optional)
            </label>
            <RepoSelector
              username={username}
              value={w.config.githubRepo ?? null}
              onChange={(val) => w.updateConfig("githubRepo", val)}
            />
            <div id="github-repo-help" className="mt-1 font-mono text-[10px] text-text-4">
              The link is displayed for visitors to inspect independently.
            </div>
            {w.config.githubRepo && (
              <RepoActivityCard key={w.config.githubRepo} repo={w.config.githubRepo} />
            )}
          </div>

          {/* Live URL */}
          <div className="mb-4">
            <label htmlFor="live-url" className="form-label">
              Live URL (optional)
            </label>
            <input
              id="live-url"
              type="url"
              inputMode="url"
              placeholder="https://your-app.com"
              className="form-input"
              value={w.config.liveUrl ?? ""}
              onChange={(e) =>
                w.updateConfig("liveUrl", e.target.value || null)
              }
            />
            <div className="mt-0.5 font-mono text-[10px] text-text-4">
              LCKD does not continuously verify availability or ownership of this URL.
            </div>
          </div>

          {/* Tier ladder */}
          <div className="mb-5">
            <TierLadder
              tier={w.computedTier}
              hasRepo={Boolean(w.config.githubRepo)}
              hasLive={Boolean(w.config.liveUrl)}
            />
          </div>

          <div className="flex gap-2.5">
            <button onClick={w.goBack} className="btn-secondary flex-1 py-3">
              &larr; back
            </button>
            <button onClick={w.goNext} className="btn-primary flex-[2] py-3">
              continue &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
