import type { Metadata } from "next";
import { getTokens, getCommits } from "@/lib/queries";
import FeedClient from "./FeedClient";

export const metadata: Metadata = {
  title: "Explore Builders — Lockpad",
  description:
    "Browse verified token launches with locked dev allocations. Filter by trust tier — every project on Lockpad has on-chain token locks.",
  openGraph: {
    title: "Explore Builders — Lockpad",
    description:
      "Browse verified token launches with locked dev allocations on Solana.",
    siteName: "Lockpad",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Explore Builders — Lockpad",
    description:
      "Browse verified token launches with locked dev allocations on Solana.",
  },
};

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const tokens = await getTokens();
  const commits = getCommits();

  return <FeedClient tokens={tokens} commits={commits} />;
}
