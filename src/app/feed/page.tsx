import type { Metadata } from "next";
import { getTokens, getCommits } from "@/lib/queries";
import FeedClient from "./FeedClient";

export const metadata: Metadata = {
  title: "Explore Builders — trudev.fun",
  description:
    "Browse verified token launches with locked dev allocations. Filter by trust tier — every project on trudev.fun has on-chain vesting locks.",
  openGraph: {
    title: "Explore Builders — trudev.fun",
    description:
      "Browse verified token launches with locked dev allocations on Solana.",
    siteName: "trudev.fun",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Explore Builders — trudev.fun",
    description:
      "Browse verified token launches with locked dev allocations on Solana.",
  },
};

export const revalidate = 30;

export default async function FeedPage() {
  const tokens = await getTokens();
  const commits = getCommits();

  return <FeedClient tokens={tokens} commits={commits} />;
}
