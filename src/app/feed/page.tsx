import type { Metadata } from "next";
import { getTokens } from "@/lib/queries";
import { getNextUnlock } from "@/lib/trust/unlocksQuery";
import { PENDING_MANUAL_LAUNCHES } from "@/lib/pendingLaunches";
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

/** Compact `Xd YYh` label for the next upcoming cliff, or null when the soonest
 * lock is already overdue/eligible (no forward countdown to show). */
function nextUnlockCountdown(cliffTs: string): string | null {
  const deltaMs = new Date(cliffTs).getTime() - Date.now();
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return null;
  const days = Math.floor(deltaMs / 86_400_000);
  const hours = Math.floor((deltaMs % 86_400_000) / 3_600_000);
  return `${days}d ${String(hours).padStart(2, "0")}h`;
}

export default async function FeedPage() {
  const [tokens, nextUnlock] = await Promise.all([getTokens(), getNextUnlock()]);
  const nextUnlockLabel = nextUnlock ? nextUnlockCountdown(nextUnlock.cliffTs) : null;

  return (
    <FeedClient
      tokens={tokens}
      pendingLaunches={PENDING_MANUAL_LAUNCHES}
      nextUnlockLabel={nextUnlockLabel}
    />
  );
}
