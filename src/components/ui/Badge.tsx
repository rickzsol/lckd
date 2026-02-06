import { TrustTier } from "@/types/index";

const TIER_STYLES: Record<TrustTier, { bg: string; border: string; text: string }> = {
  [TrustTier.LOCKED]: { bg: "rgba(100,100,100,0.2)", border: "#555", text: "#999" },
  [TrustTier.VERIFIED]: { bg: "rgba(59,130,246,0.12)", border: "#3b82f6", text: "#60a5fa" },
  [TrustTier.BUILDER]: { bg: "rgba(168,85,247,0.12)", border: "#a855f7", text: "#c084fc" },
  [TrustTier.SHIPPED]: { bg: "rgba(16,185,129,0.12)", border: "#10b981", text: "#34d399" },
};

export default function Badge({ tier, label }: { tier: TrustTier; label: string }) {
  const s = TIER_STYLES[tier];
  return (
    <span
      className="inline-flex items-center gap-[3px] whitespace-nowrap rounded px-[7px] py-[2px] font-mono text-[9px] font-bold tracking-wide"
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text }}
    >
      {tier >= TrustTier.VERIFIED && (
        <span className="h-1 w-1 rounded-full" style={{ background: s.text }} />
      )}
      {label}
    </span>
  );
}
