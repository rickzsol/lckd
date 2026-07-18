import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { isValidGitHubUsername } from "@/lib/api/validation";

export { OPTIONS };

export interface ContributionDay {
  date: string;
  level: number;
}

/**
 * Public contribution calendar, parsed from the same HTML GitHub renders on
 * profile pages. Serves public data only, so no session is required; abuse is
 * bounded by the shared github rate limit bucket and a one hour cache.
 */
export async function GET(req: NextRequest) {
  const limited = await checkRateLimit(req, "github");
  if (limited) return limited;

  const username = req.nextUrl.searchParams.get("username");
  if (!username || !isValidGitHubUsername(username)) {
    return apiError("Valid username required", 400);
  }

  try {
    const res = await fetch(
      `https://github.com/users/${encodeURIComponent(username)}/contributions`,
      {
        headers: { "User-Agent": "lckd", Accept: "text/html" },
        next: { revalidate: 3600 },
      },
    );

    if (!res.ok) {
      return apiError(`GitHub returned ${res.status}`, res.status === 404 ? 404 : 502);
    }

    const html = await res.text();
    const days: ContributionDay[] = [];

    for (const cell of html.matchAll(/<td[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*>/g)) {
      const level = /data-level="(\d)"/.exec(cell[0]);
      if (level) days.push({ date: cell[1], level: Number(level[1]) });
    }

    if (days.length === 0) {
      return apiError("Contribution calendar unavailable", 502);
    }

    days.sort((a, b) => a.date.localeCompare(b.date));

    const totalMatch = /([\d,]+)\s+contributions?\s+in the last year/.exec(html);
    const total = totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : null;

    return apiResponse({ total, days });
  } catch {
    return apiError("Failed to fetch contributions", 502);
  }
}
