import "server-only";

import {
  parseOfficialLaunchResponse,
  type OfficialLaunchEvent,
  type OfficialLaunchResponse,
} from "./launchMonitor";

function validMonitorUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const isLocal = process.env.NODE_ENV !== "production" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getPublicLaunchMonitorUrl(): string | null {
  return validMonitorUrl(process.env.NEXT_PUBLIC_LAUNCH_MONITOR_URL);
}

export async function getOfficialLaunch(): Promise<OfficialLaunchEvent | null> {
  const monitorUrl = validMonitorUrl(
    process.env.LAUNCH_MONITOR_URL ?? process.env.NEXT_PUBLIC_LAUNCH_MONITOR_URL,
  );
  if (!monitorUrl) return null;

  try {
    const response = await fetch(`${monitorUrl}/latest`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return null;
    const body = parseOfficialLaunchResponse(await response.json() as OfficialLaunchResponse);
    return body?.launch ?? null;
  } catch (error) {
    console.error(
      "[launch-monitor] Initial read failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return null;
  }
}
