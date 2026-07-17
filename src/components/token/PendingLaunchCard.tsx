import TokenImage from "@/components/ui/TokenImage";
import type { PendingManualLaunch } from "@/lib/pendingLaunches";

const LINK_LABELS = { website: "Website", x: "X", github: "GitHub" } as const;

export default function PendingLaunchCard({ launch }: { launch: PendingManualLaunch }) {
  const shortenedAddress = launch.contractAddress
    ? `${launch.contractAddress.slice(0, 4)}...${launch.contractAddress.slice(-4)}`
    : null;

  return (
    <article className="rounded-card border border-warn/30 bg-[rgba(224,167,62,0.035)] p-4 sm:p-5">
      <div className="flex items-start gap-3.5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-warn/25 bg-surface-deep">
          <TokenImage src={launch.image} alt={`${launch.name} token logo`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-sans text-[16px] font-bold text-text-1">{launch.name}</h2>
            <span className="font-mono text-xs text-text-3">{launch.ticker}</span>
            <span className="inline-flex rounded-md border border-warn/35 bg-[rgba(224,167,62,0.08)] px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-warn">
              Pending manual launch
            </span>
          </div>
          <p className="mt-2 max-w-2xl font-sans text-sm leading-[1.55] text-text-2">{launch.description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {launch.contractAddress ? (
              <a href={`https://solscan.io/token/${launch.contractAddress}`} target="_blank" rel="noopener noreferrer" className="rounded-control border border-warn/30 bg-surface-deep px-3 py-2 font-mono text-[11px] font-semibold text-warn transition-colors duration-180 ease-out hover:border-warn/60">
                CA {shortenedAddress} <span aria-hidden="true">&#8599;</span>
              </a>
            ) : (
              <span className="rounded-control border border-line-default bg-surface-deep px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">CA pending</span>
            )}
            {Object.entries(launch.links).map(([kind, href]) => (
              <a key={kind} href={href} target="_blank" rel="noopener noreferrer" className="rounded-control border border-line-default bg-surface-deep px-3 py-2 font-mono text-[11px] font-semibold text-text-2 transition-colors duration-180 ease-out hover:border-accent/35 hover:text-accent-400">
                {LINK_LABELS[kind as keyof typeof LINK_LABELS]} <span aria-hidden="true">&#8599;</span>
              </a>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-4 border-t border-line pt-3 font-mono text-[10px] leading-[1.6] text-text-3">
        This is a curated announcement, not a verified launch or lock record. No market data or lock claim is available yet.
      </p>
    </article>
  );
}
