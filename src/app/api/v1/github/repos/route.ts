import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { requireAuth } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { isValidGitHubUsername } from "@/lib/api/validation";

export { OPTIONS };

interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  updated_at: string;
  fork: boolean;
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit(req, "github");
  if (limited) return limited;

  const { session, error: authErr } = await requireAuth();
  if (authErr) return authErr;

  const username = req.nextUrl.searchParams.get("username");
  if (!username || !isValidGitHubUsername(username)) {
    return apiError("Valid username required", 400);
  }

  // Only allow fetching repos for the authenticated user
  if (!session.github_username || username.toLowerCase() !== session.github_username.toLowerCase()) {
    return apiError("Can only fetch repos for your own account", 403);
  }

  const pat = process.env.GITHUB_PAT;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "lckd",
  };
  if (pat) headers.Authorization = `Bearer ${pat}`;

  try {
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated&type=owner`,
      { headers, next: { revalidate: 300 } },
    );

    if (!res.ok) {
      return apiError(`GitHub API returned ${res.status}`, res.status);
    }

    const raw: GitHubRepo[] = await res.json();

    const repos = raw
      .filter((r) => !r.fork)
      .map((r) => ({
        full_name: r.full_name,
        name: r.name,
        description: r.description,
        stars: r.stargazers_count,
        language: r.language,
      }));

    return apiResponse(repos);
  } catch {
    return apiError("Failed to fetch repositories", 502);
  }
}
