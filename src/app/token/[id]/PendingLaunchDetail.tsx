import Link from "next/link";
import TokenImage from "@/components/ui/TokenImage";
import type { PendingManualLaunch } from "@/lib/pendingLaunches";

const LINK_LABELS = {
  website: "Website",
  x: "X",
  github: "GitHub",
} as const;

export default function PendingLaunchDetail({ launch }: { launch: PendingManualLaunch }) {
  return (
    <main className="mx-auto max-w-[920px] px-4 pb-16 pt-28 sm:px-6">
      <Link href="/feed" className="mb-6 inline-block font-mono text-xs text-text-3 transition-colors duration-180 ease-out hover:text-accent-400">
        &larr; back to feed
      </Link>

      <section className="overflow-hidden rounded-card border border-line-default bg-surface">
        <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[180px_1fr] md:items-center">
          <div className="aspect-square overflow-hidden rounded-[18px] border border-accent/20 bg-surface-deep shadow-[0_0_48px_rgba(39,211,139,0.08)]">
            <TokenImage src={launch.image} alt={`${launch.name} token logo`} />
          </div>

          <div>
            <div className="flex flex-wrap items-baseline gap-3">
              <h1 className="font-sans text-[clamp(32px,7vw,58px)] font-bold leading-none tracking-[-0.04em] text-text-1">{launch.name}</h1>
              <span className="font-mono text-sm text-accent-400">{launch.ticker}</span>
            </div>
            <p className="mt-5 max-w-xl font-sans text-base leading-7 text-text-2">{launch.description}</p>

            <div className="mt-7 flex flex-wrap gap-2">
              {Object.entries(launch.links).map(([kind, href]) => (
                <a key={kind} href={href} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                  {LINK_LABELS[kind as keyof typeof LINK_LABELS]} <span aria-hidden="true">&#8599;</span>
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="grid border-t border-line-default sm:grid-cols-2">
          <div className="border-b border-line-default p-5 sm:border-b-0 sm:border-r">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">Contract address</div>
            <div className="mt-2 font-mono text-sm font-semibold text-text-1">{launch.contractAddress ?? "Available after launch"}</div>
          </div>
          <div className="p-5">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">Official repository</div>
            <a href={launch.links.github} target="_blank" rel="noopener noreferrer" className="mt-2 block truncate font-mono text-sm font-semibold text-accent-400 hover:underline">
              github.com/rickzsol/lckd
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
