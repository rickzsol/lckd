import {
  getOfficialLaunch,
  getPublicLaunchMonitorUrl,
} from "@/lib/launchMonitorClient.server";
import { OFFICIAL_TOKEN_METADATA } from "@/lib/officialTokenRoute";
import OfficialTokenClient from "./OfficialTokenClient";

export const dynamic = "force-dynamic";
export const metadata = OFFICIAL_TOKEN_METADATA;

export default async function OfficialTokenPage() {
  return (
    <OfficialTokenClient
      initialLaunch={await getOfficialLaunch()}
      monitorUrl={getPublicLaunchMonitorUrl()}
    />
  );
}
