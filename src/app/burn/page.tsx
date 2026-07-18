import type { Metadata } from "next";
import Image from "next/image";
import { getBurnLedger, LCKD_MINT, type BurnEvent } from "@/lib/burnLedger";

export const revalidate = 300;

const SOLSCAN_TX = "https://solscan.io/tx";

export const metadata: Metadata = {
  title: "Burn ledger",
  description:
    "Every LCKD buyback and burn funded by launch fees, listed with its on-chain signature.",
  alternates: { canonical: "/burn" },
  openGraph: {
    title: "Burn ledger | LCKD",
    description: "Launch fees buy LCKD and burn it. Every entry is a transaction.",
    url: "/burn",
    type: "website",
  },
};

function formatAmount(value: number, digits = 2): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "--";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function EventRow({ event }: { event: BurnEvent }) {
  const isBurn = event.kind === "burn";
  return (
    <a
      href={`${SOLSCAN_TX}/${event.signature}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line-default bg-surface-deep px-4 py-3 transition-colors duration-180 ease-out hover:border-accent/35"
    >
      <div className="flex items-center gap-3">
        <span
          className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] ${
            isBurn ? "bg-accent-dim text-accent-400" : "bg-surface-2 text-text-2"
          }`}
        >
          {event.kind}
        </span>
        <span className="font-mono text-sm font-semibold text-text-1 tabular-nums">
          {isBurn
            ? `${formatAmount(event.lckdAmount ?? 0)} LCKD burned`
            : `${formatAmount(event.solAmount ?? 0, 4)} SOL for ${formatAmount(event.lckdAmount ?? 0)} LCKD`}
        </span>
      </div>
      <div className="flex items-center gap-3 font-mono text-[11px] text-text-3 tabular-nums">
        <span>{formatDate(event.executedAt)}</span>
        <span className="text-accent-400">
          {event.signature.slice(0, 4)}&hellip;{event.signature.slice(-4)} &#8599;
        </span>
      </div>
    </a>
  );
}

export default async function BurnPage() {
  const ledger = await getBurnLedger();
  const hasEvents = ledger.events.length > 0;
  const stats = [
    { label: "SOL spent", value: `${formatAmount(ledger.totals.solSpent, 4)}` },
    { label: "LCKD bought", value: formatAmount(ledger.totals.lckdBought) },
    { label: "LCKD burned", value: formatAmount(ledger.totals.lckdBurned), isAccent: true },
    {
      label: "Current supply",
      value: ledger.supply.current === null ? "--" : formatAmount(ledger.supply.current),
    },
  ];

  return (
    <div className="mx-auto max-w-[1152px] bg-bg px-4 pt-28 pb-24 sm:px-6">
      <header className="mx-auto max-w-3xl border-b border-line pb-12 sm:pb-14">
        <h1 className="font-sans text-[32px] font-bold tracking-[-0.02em] text-text-1 sm:text-[clamp(32px,5vw,44px)]">
          Launch fees burn LCKD
        </h1>
        <p className="mt-5 max-w-2xl text-[15px] leading-[1.6] text-text-2">
          Every token launch pays a flat SOL fee. Collected fees buy LCKD on the open
          market, and the purchased tokens are burned. Every step below is a transaction
          you can verify.
        </p>
      </header>

      <div className="mx-auto mt-10 max-w-3xl space-y-14">
        <section>
          <div className="stats-strip">
            {stats.map((s) => (
              <div key={s.label}>
                <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
                  {s.label}
                </div>
                <div
                  className={`font-mono text-[clamp(13px,2.5vw,16px)] font-bold tabular-nums ${
                    s.isAccent ? "text-accent-400" : "text-text-1"
                  }`}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-[11px] leading-[1.6] text-text-3">
            Current supply is read from the mint on-chain. LCKD has no mint authority, so
            supply can only decrease.
          </p>
        </section>

        <section className="space-y-5">
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
            How it works
          </h2>
          <div className="space-y-4 rounded-card border border-line-default bg-surface p-5">
            {[
              {
                n: 1,
                label: "Collect",
                sub: "The launch fee transfers inside the same atomic transaction that creates and locks each token. Nobody launches without paying, nobody pays without launching.",
              },
              {
                n: 2,
                label: "Buy back",
                sub: "When the treasury crosses its threshold, it swaps the collected SOL for LCKD on the open market with a strict slippage cap.",
              },
              {
                n: 3,
                label: "Burn",
                sub: "The purchased LCKD is destroyed with a token burn instruction. Total supply decreases on-chain, visible on any explorer.",
              },
            ].map((step) => (
              <div key={step.n} className="flex gap-4">
                <span className="review-num shrink-0">{step.n}</span>
                <div>
                  <div className="font-mono text-[13px] font-bold text-text-1">{step.label}</div>
                  <p className="mt-1 font-sans text-sm leading-[1.6] text-text-2">{step.sub}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="warning-box !block leading-[1.6]">
            This ledger lists only finalized transactions. It is a record, not a promise:
            if an entry is missing a signature or the totals disagree with the chain,
            treat the chain as the truth.
          </div>
        </section>

        <section className="space-y-5">
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
            Ledger
          </h2>
          {hasEvents ? (
            <div className="space-y-2.5">
              {ledger.events.map((event) => (
                <EventRow key={event.signature} event={event} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center rounded-card border border-line-default bg-surface px-6 py-14 text-center">
              <Image
                src="/logo.png"
                alt=""
                width={56}
                height={56}
                className="mb-4 opacity-80"
              />
              <p className="font-mono text-sm font-semibold text-text-1">
                No burns recorded yet
              </p>
              <p className="mt-2 max-w-[420px] font-mono text-xs leading-[1.7] text-text-3">
                The first buyback executes once collected fees cross the treasury
                threshold. Every future buyback and burn lands here with its signature.
              </p>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
            Verify independently
          </h2>
          <p className="font-sans text-sm leading-[1.6] text-text-2">
            The LCKD mint is public. Check its supply history and every transaction on
            this page yourself.
          </p>
          <a
            href={`https://solscan.io/token/${LCKD_MINT}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary inline-flex"
          >
            LCKD mint on Solscan <span aria-hidden="true">&#8599;</span>
          </a>
        </section>
      </div>
    </div>
  );
}
