import { riskLevelColor, type RicomapsSummary } from "@/lib/ricomaps.client";

export default function RiskChip({ summary }: { summary: RicomapsSummary }) {
  const c = riskLevelColor(summary.riskLevel);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold tabular-nums ${c.text} ${c.bg} ${c.border}`}
    >
      {summary.riskScore}/100
    </span>
  );
}
