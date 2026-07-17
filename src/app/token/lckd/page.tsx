import type { Metadata } from "next";
import {
  getOfficialLaunch,
  getPublicLaunchMonitorUrl,
} from "@/lib/launchMonitorClient.server";
import OfficialTokenClient from "./OfficialTokenClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "LCKD ($LCKD)",
  description: "Live contract address, chart, market data, and Streamflow lock record for the official LCKD token.",
  alternates: { canonical: "/token/lckd" },
  openGraph: {
    title: "LCKD ($LCKD)",
    description: "The live on-chain record for the official LCKD token.",
    images: [{ url: "/lckd-token.png", width: 512, height: 512, alt: "LCKD token" }],
    url: "/token/lckd",
  },
};

export default async function OfficialTokenPage() {
  return (
    <OfficialTokenClient
      initialLaunch={await getOfficialLaunch()}
      monitorUrl={getPublicLaunchMonitorUrl()}
    />
  );
}
