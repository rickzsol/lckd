import { NextRequest, NextResponse } from "next/server";

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
  const username = req.nextUrl.searchParams.get("username");
  if (!username) {
    return NextResponse.json({ error: "username required" }, { status: 400 });
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
      return NextResponse.json(
        { error: `GitHub API returned ${res.status}` },
        { status: res.status },
      );
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

    return NextResponse.json(repos);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch repositories" },
      { status: 502 },
    );
  }
}
