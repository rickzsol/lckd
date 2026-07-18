import type { Metadata } from "next";
import { LCKD_MINT } from "@/lib/burnLedger";
import { getPublicLaunchMonitorUrl } from "@/lib/launchMonitorClient.server";
import { getTokens } from "@/lib/queries";
import FeedClient from "./FeedClient";

export const metadata: Metadata = {
  title: "Launch directory",
  description:
    "Browse LCKD launch records and open external sources to verify token, developer, market, and lock claims independently.",
  alternates: { canonical: "/feed" },
  openGraph: {
    title: "Launch directory | LCKD",
    description:
      "Browse platform records and verify every claim independently.",
    url: "/feed",
    siteName: "LCKD",
    type: "website",
  },
};

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const tokens = await getTokens(LCKD_MINT);

  return (
    <FeedClient
      launchMonitorUrl={getPublicLaunchMonitorUrl()}
      tokens={tokens}
      officialMintAddress={LCKD_MINT}
    />
  );
}
