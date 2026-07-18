import type { Metadata } from "next";
import { getTokens } from "@/lib/queries";
import {
  getOfficialLaunch,
  getPublicLaunchMonitorUrl,
} from "@/lib/launchMonitorClient.server";
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
  const [tokens, officialLaunch] = await Promise.all([
    getTokens(),
    getOfficialLaunch(),
  ]);

  return (
    <FeedClient
      tokens={tokens}
      officialLaunch={officialLaunch}
      launchMonitorUrl={getPublicLaunchMonitorUrl()}
    />
  );
}
