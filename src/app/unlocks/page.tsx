import type { Metadata } from "next";
import Link from "next/link";
import Badge from "@/components/ui/Badge";
import TokenImage from "@/components/ui/TokenImage";
import { getUpcomingUnlocks, type UnlockCalendarRow } from "@/lib/trust/unlocksQuery";
import { TrustTier } from "@/types/index";

export const metadata: Metadata = {
  title: "upcoming unlocks",
  description:
    "Cliff-locked token unlocks on LCKD. Zero unlocks before the cliff, the full locked amount at the cliff, no linear vesting. Verify every claim on-chain.",
  alternates: { canonical: "/unlocks" },
  openGraph: {
    title: "upcoming unlocks | LCKD",
    description:
      "Cliff-locked token unlocks. No linear vesting - the full amount releases at the cliff. Verify on-chain.",
    url: "/unlocks",
    siteName: "LCKD",
    type: "website",
  },
};

export const dynamic = "force-dynamic";

const TIER_LABELS: Record<TrustTier, string> = {
  [TrustTier.LOCKED]: "LOCKED",
  [TrustTier.VERIFIED]: "VERIFIED",
  [TrustTier.BUILDER]: "BUILDER",
  [TrustTier.SHIPPED]: "SHIPPED",
};

const WARN_THRESHOLD_MS = 7 * 86_400_000;

/** Milliseconds from now until the cliff. Read outside the component body so the
 * render stays pure per react-hooks/purity. */
function msUntilCliff(cliffTs: string): number {
  return new Date(cliffTs).getTime() - Date.now();
}

/** Static `Xd YYh` countdown to the cliff. Non-positive deltas (overdue eligible
 * rows) render as `0d 00h` so the pulse/unlockable state carries the meaning. */
function formatCountdown(cliffTs: string): string {
  const deltaMs = msUntilCliff(cliffTs);
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return "0d 00h";
  const days = Math.floor(deltaMs / 86_400_000);
  const hours = Math.floor((deltaMs % 86_400_000) / 3_600_000);
  return `${days}d ${String(hours).padStart(2, "0")}h`;
}

function formatDateHeader(cliffTs: string): string {
  const d = new Date(cliffTs);
  if (!Number.isFinite(d.getTime())) return "unknown";
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();
}

function dateKey(cliffTs: string): string {
  const d = new Date(cliffTs);
  if (!Number.isFinite(d.getTime())) return "unknown";
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function groupByDate(rows: UnlockCalendarRow[]): Array<{ key: string; label: string; rows: UnlockCalendarRow[] }> {
  const groups = new Map<string, { key: string; label: string; rows: UnlockCalendarRow[] }>();
  for (const row of rows) {
    const key = dateKey(row.cliffTs);
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
    } else {
      groups.set(key, { key, label: formatDateHeader(row.cliffTs), rows: [row] });
    }
  }
  return [...groups.values()];
}

export default async function UnlocksPage() {
  const result = await getUpcomingUnlocks();
  const isDegraded = result.status === "degraded";
  const groups = groupByDate(result.rows);

  return (
    <div className="mx-auto max-w-[1152px] px-4 pt-28 pb-16 sm:px-6">
      <div className="mb-6">
        <h1 className="font-sans text-[clamp(28px,6vw,40px)] font-bold tracking-[-0.02em] text-text-1">
          upcoming unlocks
        </h1>
        <p className="mt-2 max-w-2xl font-mono text-[12px] leading-[1.7] text-text-3">
          cliff locks, not vesting. zero tokens unlock before the cliff, the full locked
          amount becomes eligible at the cliff, and nothing releases linearly in between.
          verify every cliff and amount on-chain.
        </p>
      </div>

      {isDegraded ? (
        <div className="flex flex-col items-center py-20 text-center">
          <div className="font-mono text-[48px] text-text-4">{"!"}</div>
          <p className="mt-3 font-mono text-sm text-text-3">
            unlock data is temporarily unavailable. this does not mean nothing is
            unlocking. refresh in a moment.
          </p>
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <div className="font-mono text-[48px] text-text-4">{"{ }"}</div>
          <p className="mt-3 font-mono text-sm text-text-3">
            nothing unlocking. exactly how it should look.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.label}>
              <h2 className="mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">
                {group.label}
              </h2>
              <div className="flex flex-col gap-2.5">
                {group.rows.map((row) => (
                  <UnlockRow key={row.mint + row.cliffTs} row={row} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function UnlockRow({ row }: { row: UnlockCalendarRow }) {
  const isEligible = row.status === "unlock_eligible";
  const deltaMs = msUntilCliff(row.cliffTs);
  const isSoon = Number.isFinite(deltaMs) && deltaMs > 0 && deltaMs <= WARN_THRESHOLD_MS;
  const countdown = formatCountdown(row.cliffTs);
  const name = row.name ?? "unknown token";
  const ticker = row.ticker ? `$${row.ticker}` : "";
  const pct = row.pctOfSupply;

  return (
    <Link href={`/token/${row.mint}`} className="token-card block">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-accent/25 bg-accent-dim">
          <TokenImage src={row.image ?? "??"} alt={name} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-sans text-[15px] font-bold text-text-1">{name}</span>
            {ticker && <span className="font-mono text-xs text-text-3">{ticker}</span>}
            <Badge tier={row.tier} label={TIER_LABELS[row.tier]} />
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-text-3 tabular-nums">
            {pct !== null ? `${pct.toFixed(1)}% of supply` : "supply share unknown"}
          </div>
        </div>

        <div className="shrink-0 text-right">
          {isEligible ? (
            <div className="flex items-center justify-end gap-1.5">
              <span className="pulse-dot" style={{ background: "var(--color-danger)" }} />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wide text-danger">
                unlockable
              </span>
            </div>
          ) : (
            <div
              className={`font-mono text-sm font-bold tabular-nums ${isSoon ? "text-warn" : "text-text-1"}`}
            >
              {countdown}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
