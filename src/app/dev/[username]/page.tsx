import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProfileByUsername, getTokensByCreator } from "@/lib/profile";
import { getGitHubProfile, getContributionActivity } from "@/lib/github/api";
import DevProfileClient from "./DevProfileClient";

export const revalidate = 60;

interface Props {
  params: Promise<{ username: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const profile = await getProfileByUsername(username);

  if (!profile) {
    return { title: "Profile Not Found — trudev.fun" };
  }

  return {
    title: `@${profile.github_username} — trudev.fun`,
    description: `${profile.github_username}'s developer profile on trudev.fun. ${profile.public_repos} repos, ${profile.total_commits} commits.`,
    openGraph: {
      title: `@${profile.github_username} — trudev.fun`,
      description: `Developer profile with ${profile.public_repos} repos on trudev.fun`,
      images: profile.github_avatar ? [profile.github_avatar] : undefined,
    },
  };
}

export default async function DevProfilePage({ params }: Props) {
  const { username } = await params;
  const profile = await getProfileByUsername(username);

  if (!profile) notFound();

  const [tokens, githubData, contributions] = await Promise.all([
    getTokensByCreator(username),
    getGitHubProfile(username).catch(() => null),
    getContributionActivity(username).catch(() => []),
  ]);

  return (
    <DevProfileClient
      profile={profile}
      tokens={tokens}
      githubData={githubData}
      contributions={contributions}
    />
  );
}
