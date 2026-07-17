import type { RicomapsSummary } from "@/lib/ricomaps.types";

const TOP10_WARN_THRESHOLD = 25;

function cellValueColor(isWarn: boolean, isDanger: boolean): string {
  if (isDanger) return "text-danger";
  if (isWarn) return "text-warn";
  return "text-text-1";
}

export default function StatCells({ summary }: { summary: RicomapsSummary }) {
  const cells = [
    {
      label: "top 10 holders",
      value: `${summary.top10Pct.toFixed(1)}%`,
      isWarn: summary.top10Pct >= TOP10_WARN_THRESHOLD,
      isDanger: false,
    },
    {
      label: "dev wallet",
      value: `${summary.devWalletPct.toFixed(1)}%`,
      isWarn: false,
      isDanger: false,
    },
    {
      label: "sniped at launch",
      value: `${summary.snipedAtLaunchPct.toFixed(1)}%`,
      isWarn: summary.snipedAtLaunchPct > 0 && !summary.coordinatedEntry,
      isDanger: summary.coordinatedEntry,
    },
    {
      label: "clustered supply",
      value: `${summary.clusteredSupplyPct.toFixed(1)}%`,
      isWarn: summary.clusteredSupplyPct >= TOP10_WARN_THRESHOLD && !summary.coordinatedEntry,
      isDanger: summary.coordinatedEntry,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.label} className="rounded-control bg-surface-deep px-3 py-2">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
            {cell.label}
          </div>
          <div
            className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${cellValueColor(cell.isWarn, cell.isDanger)}`}
          >
            {cell.value}
          </div>
        </div>
      ))}
    </div>
  );
}
