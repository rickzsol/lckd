import type {
  GitHubProfile,
  GitHubRepoData,
  GitHubCommit,
  ContributionDay,
} from "@/types";

const GITHUB_API = "https://api.github.com";
const RATE_LIMIT_THRESHOLD = 10;

interface RateLimitState {
  remaining: number;
  resetAt: number;
}

const rateLimitState: RateLimitState = { remaining: Infinity, resetAt: 0 };

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function updateRateLimit(res: Response) {
  const remaining = res.headers.get("X-RateLimit-Remaining");
  const reset = res.headers.get("X-RateLimit-Reset");
  if (remaining !== null) rateLimitState.remaining = Number(remaining);
  if (reset !== null) rateLimitState.resetAt = Number(reset) * 1000;
}

async function checkRateLimit(): Promise<void> {
  if (
    rateLimitState.remaining > RATE_LIMIT_THRESHOLD ||
    Date.now() > rateLimitState.resetAt
  ) {
    return;
  }

  const waitMs = rateLimitState.resetAt - Date.now() + 1000;
  if (waitMs > 0 && waitMs < 60_000) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function ghFetch<T>(path: string, token?: string): Promise<T> {
  await checkRateLimit();

  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: buildHeaders(token),
    next: { revalidate: 300 },
  });

  updateRateLimit(res);

  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${path}`);
  }

  return res.json() as Promise<T>;
}

interface GitHubUserResponse {
  login: string;
  avatar_url: string;
  bio: string | null;
  public_repos: number;
  created_at: string;
  id: number;
}

export async function getGitHubProfile(
  username: string,
  token?: string,
): Promise<
  Pick<
    GitHubProfile,
    "github_username" | "github_avatar" | "account_created_at" | "public_repos"
  > & { bio: string | null }
> {
  const data = await ghFetch<GitHubUserResponse>(
    `/users/${encodeURIComponent(username)}`,
    token,
  );

  return {
    github_username: data.login,
    github_avatar: data.avatar_url,
    account_created_at: data.created_at,
    public_repos: data.public_repos,
    bio: data.bio,
  };
}

interface GitHubRepoResponse {
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  created_at: string;
  updated_at: string;
  default_branch: string;
}

export async function getGitHubRepoDetails(
  owner: string,
  repo: string,
  token?: string,
): Promise<GitHubRepoData> {
  const data = await ghFetch<GitHubRepoResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    token,
  );

  return {
    description: data.description,
    stars: data.stargazers_count,
    forks: data.forks_count,
    language: data.language,
    created_at: data.created_at,
    updated_at: data.updated_at,
    default_branch: data.default_branch,
  };
}

interface GitHubCommitResponse {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
}

export async function getRecentCommits(
  owner: string,
  repo: string,
  limit: number = 10,
  token?: string,
): Promise<GitHubCommit[]> {
  const data = await ghFetch<GitHubCommitResponse[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=${limit}`,
    token,
  );

  return data.map((c) => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split("\n")[0],
    author: c.commit.author.name,
    date: c.commit.author.date,
  }));
}

const MAX_COMMIT_PAGES = 5;

export async function getCommitCountSinceLaunch(
  owner: string,
  repo: string,
  since: string,
  token?: string,
): Promise<number> {
  let count = 0;
  let page = 1;
  const perPage = 100;

  while (page <= MAX_COMMIT_PAGES) {
    const data = await ghFetch<GitHubCommitResponse[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?since=${encodeURIComponent(since)}&per_page=${perPage}&page=${page}`,
      token,
    );

    count += data.length;
    if (data.length < perPage) break;
    page++;
  }

  return count;
}

interface GitHubEvent {
  type: string;
  created_at: string;
}

export async function getContributionActivity(
  username: string,
  token?: string,
): Promise<ContributionDay[]> {
  const events = await ghFetch<GitHubEvent[]>(
    `/users/${encodeURIComponent(username)}/events?per_page=100`,
    token,
  );

  const pushEvents = events.filter((e) => e.type === "PushEvent");

  const dayCounts = new Map<string, number>();
  for (const event of pushEvents) {
    const day = event.created_at.slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  return Array.from(dayCounts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
