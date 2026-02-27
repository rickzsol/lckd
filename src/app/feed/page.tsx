import type { Metadata } from "next";
import { getTokens } from "@/lib/queries";
import FeedClient from "./FeedClient";

export const metadata: Metadata = {
  title: "Explore Builders — LCKD",
  description:
    "Browse verified token launches with locked dev allocations. Filter by trust tier — every project on LCKD has on-chain token locks.",
  openGraph: {
    title: "Explore Builders — LCKD",
    description:
      "Browse verified token launches with locked dev allocations on Solana.",
    siteName: "LCKD",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "LCKD" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Explore Builders — LCKD",
    description:
      "Browse verified token launches with locked dev allocations on Solana.",
    images: ["/og.png"],
  },
};

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const tokens = await getTokens();

  return <FeedClient tokens={tokens} />;
}
