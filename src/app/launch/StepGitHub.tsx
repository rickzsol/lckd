"use client";

import { useSession, signIn } from "next-auth/react";
import { useState, useEffect, useRef, useCallback } from "react";
import Badge from "@/components/ui/Badge";
import { TrustTier } from "@/types/index";
import type { WizardContext } from "@/hooks/useLaunchWizard";

interface RepoItem {
  full_name: string;
  name: string;
  description: string | null;
  stars: number;
  language: string | null;
}

function RepoSelector({
  username,
  value,
  onChange,
}: {
  username: string;
  value: string | null;
  onChange: (val: string | null) => void;
}) {
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!username) return;
    setIsLoading(true);
    fetch(`/api/v1/github/repos?username=${encodeURIComponent(username)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: RepoItem[]) => setRepos(data))
      .catch(() => setRepos([]))
      .finally(() => setIsLoading(false));
  }, [username]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = repos.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.description?.toLowerCase().includes(search.toLowerCase()) ?? false),
  );

  const handleSelect = useCallback(
    (repo: RepoItem) => {
      onChange(repo.full_name);
      setSearch("");
      setIsOpen(false);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange(null);
    setSearch("");
  }, [onChange]);

  if (value) {
    const selected = repos.find((r) => r.full_name === value);
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-accent/20 bg-emerald-accent/[0.04] px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs font-bold text-emerald-accent truncate">
            {value}
          </div>
          {selected?.description && (
            <div className="mt-0.5 font-mono text-[10px] text-[#555] truncate">
              {selected.description}
            </div>
          )}
        </div>
        <button
          onClick={handleClear}
          className="shrink-0 font-mono text-[10px] text-[#555] transition-colors hover:text-red-400"
        >
          change
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className="form-input flex cursor-pointer items-center gap-2"
        onClick={() => setIsOpen(true)}
      >
        {isOpen ? (
          <input
            autoFocus
            className="flex-1 bg-transparent font-mono text-xs text-white outline-none placeholder:text-[#444]"
            placeholder="search your repos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setIsOpen(false);
            }}
          />
        ) : (
          <span className="font-mono text-xs text-[#444]">
            {isLoading ? "loading repos..." : "select a repository"}
          </span>
        )}
        <svg
          className={`h-3 w-3 shrink-0 text-[#555] transition-transform ${isOpen ? "rotate-180" : ""}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M2 4l4 4 4-4" />
        </svg>
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[240px] overflow-y-auto rounded-lg border border-white/[0.08] bg-[#111318] shadow-xl">
          {isLoading ? (
            <div className="px-3 py-4 text-center font-mono text-[11px] text-[#555]">
              fetching repositories...
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-4 text-center font-mono text-[11px] text-[#555]">
              {search ? "no repos match" : "no repositories found"}
            </div>
          ) : (
            filtered.map((repo) => (
              <button
                key={repo.full_name}
                onClick={() => handleSelect(repo)}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-emerald-accent/[0.06]"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[12px] font-semibold text-white truncate">
                    {repo.name}
                  </div>
                  {repo.description && (
                    <div className="mt-0.5 font-mono text-[10px] text-[#555] truncate">
                      {repo.description}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2 pt-0.5">
                  {repo.language && (
                    <span className="font-mono text-[9px] text-[#444]">
                      {repo.language}
                    </span>
                  )}
                  {repo.stars > 0 && (
                    <span className="font-mono text-[9px] text-[#444]">
                      {repo.stars}*
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function StepGitHub({ w }: { w: WizardContext }) {
  const { data: session } = useSession();
  const isLinked = !!session?.github_username;

  const handleConnect = () => {
    if (isLinked) {
      w.updateConfig("githubUsername", session.github_username);
    } else {
      signIn("github", { callbackUrl: "/launch" });
    }
  };

  // Sync session to config when already linked
  if (isLinked && !w.config.githubUsername) {
    w.updateConfig("githubUsername", session.github_username);
  }

  return (
    <div>
      <div className="mb-5 font-mono text-[13px] font-bold text-emerald-accent">
        03 &mdash; GitHub Verification
      </div>
      <p className="mb-5 font-mono text-[11px] text-[#555]">
        Optional but recommended. Verified tokens get higher trust tiers and
        more visibility in the feed.
      </p>

      {!isLinked && !w.config.githubUsername ? (
        <div className="flex flex-col gap-3">
          <button
            onClick={handleConnect}
            className="btn-secondary w-full py-3.5 text-sm font-semibold text-white"
          >
            <svg
              className="mr-1.5 inline h-4 w-4"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Connect GitHub
          </button>

          {/* Tier preview */}
          <div className="flex items-center justify-center gap-2 font-mono text-[11px] text-[#444]">
            <span>Current tier:</span>
            <Badge tier={TrustTier.LOCKED} label="LOCKED" />
          </div>

          <button
            onClick={w.goNext}
            className="w-full text-center font-mono text-[11px] text-[#444] underline underline-offset-[3px] transition-colors hover:text-[#666]"
          >
            skip &mdash; token will be Tier 1 (Locked only)
          </button>

          <div className="mt-2 flex gap-2.5">
            <button onClick={w.goBack} className="btn-secondary flex-1 py-3">
              &larr; back
            </button>
          </div>
        </div>
      ) : (
        <div>
          {/* GitHub profile card */}
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-emerald-accent/20 bg-emerald-accent/[0.04] px-3.5 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-accent/10 font-mono text-sm font-bold text-emerald-accent">
              {(w.config.githubUsername ?? "?")[0].toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-emerald-accent">
                  @{w.config.githubUsername ?? session?.github_username}
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-accent" />
              </div>
              <span className="font-mono text-[10px] text-[#555]">
                GitHub connected
              </span>
            </div>
          </div>

          {/* Repo selector */}
          <div className="mb-3">
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-[#555]">
              Link a Repository (optional)
            </label>
            <RepoSelector
              username={w.config.githubUsername ?? session?.github_username ?? ""}
              value={w.config.githubRepo ?? null}
              onChange={(val) => w.updateConfig("githubRepo", val)}
            />
            <div className="mt-1 font-mono text-[9px] text-[#333]">
              Linking a repo upgrades you to Builder tier
            </div>
          </div>

          {/* Live URL */}
          <div className="mb-4">
            <label
              htmlFor="live-url"
              className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#555]"
            >
              Live URL (optional)
            </label>
            <input
              id="live-url"
              placeholder="https://your-app.com"
              className="form-input"
              value={w.config.liveUrl ?? ""}
              onChange={(e) =>
                w.updateConfig("liveUrl", e.target.value || null)
              }
            />
            <div className="mt-0.5 font-mono text-[9px] text-[#333]">
              Adding a live URL upgrades you to Shipped tier
            </div>
          </div>

          {/* Tier preview */}
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-white/6 bg-white/2 px-3 py-2.5 font-mono text-[11px] text-[#666]">
            <span>Your tier:</span>
            <Badge tier={w.computedTier} label={w.tierLabel} />
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
