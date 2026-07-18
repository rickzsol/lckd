"use client";

import { useEffect, useState } from "react";

interface RepoItem {
  full_name: string;
  name: string;
  stars: number;
  language: string | null;
}

export default function MatchRepoSelect({
  username,
  value,
  onChange,
}: {
  username: string;
  value: string;
  onChange: (repo: string) => void;
}) {
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/v1/github/repos?username=${encodeURIComponent(username)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Repository list unavailable");
        return response.json();
      })
      .then((data: RepoItem[]) => setRepos(data))
      .catch(() => setRepos([]))
      .finally(() => setIsLoading(false));
  }, [username]);

  return (
    <div>
      <label htmlFor="repo" className="form-label">
        Repository (optional)
      </label>
      <select
        id="repo"
        className="form-input"
        value={value}
        disabled={isLoading}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{isLoading ? "Loading repositories..." : "No repository linked"}</option>
        {repos.map((r) => (
          <option key={r.full_name} value={r.full_name}>
            {r.name}
            {r.language ? ` (${r.language})` : ""}
            {r.stars ? `, ${r.stars} stars` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
