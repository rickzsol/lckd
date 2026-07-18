import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { requireAuth } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { isValidGitHubUsername } from "@/lib/api/validation";

export { OPTIONS };

const REPO_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const COMMIT_LIMIT = 5;

interface GitHubRepoMeta {
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  pushed_at: string;
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit(req, "github");
  if (limited) return limited;

  const { session, error: authErr } = await requireAuth();
  if (authErr) return authErr;

  const repo = req.nextUrl.searchParams.get("repo") ?? "";
  const [owner, name, extra] = repo.split("/");
  if (!owner || !name || extra !== undefined || !isValidGitHubUsername(owner) || !REPO_NAME_PATTERN.test(name)) {
    return apiError("Valid repo required (owner/name)", 400);
  }

  // Only allow fetching activity for the authenticated user's own repos
  if (owner.toLowerCase() !== session.github_username.toLowerCase()) {
    return apiError("Can only fetch activity for your own repositories", 403);
  }

  const pat = process.env.GITHUB_PAT;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "lckd",
  };
  if (pat) headers.Authorization = `Bearer ${pat}`;

  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  try {
    const [metaRes, commitsRes] = await Promise.all([
      fetch(base, { headers, next: { revalidate: 300 } }),
      fetch(`${base}/commits?per_page=${COMMIT_LIMIT}`, { headers, next: { revalidate: 300 } }),
    ]);

    if (!metaRes.ok) {
      return apiError(`GitHub API returned ${metaRes.status}`, metaRes.status);
    }

    const meta: GitHubRepoMeta = await metaRes.json();
    const rawCommits: GitHubCommit[] = commitsRes.ok ? await commitsRes.json() : [];

    return apiResponse({
      description: meta.description,
      language: meta.language,
      stars: meta.stargazers_count,
      forks: meta.forks_count,
      pushedAt: meta.pushed_at,
      commits: rawCommits.slice(0, COMMIT_LIMIT).map((c) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split("\n")[0].slice(0, 120),
        date: c.commit.author?.date ?? null,
      })),
    });
  } catch {
    return apiError("Failed to fetch repository activity", 502);
  }
}
