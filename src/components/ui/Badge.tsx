import { TrustTier } from "@/types/index";

const TIER_STYLES: Record<TrustTier, { bg: string; border: string; text: string; glow?: string }> = {
  [TrustTier.LOCKED]: { bg: "transparent", border: "rgba(255,255,255,0.14)", text: "var(--color-text-3)" },
  [TrustTier.VERIFIED]: { bg: "rgba(43,209,126,0.06)", border: "rgba(43,209,126,0.35)", text: "var(--color-accent-400)" },
  [TrustTier.BUILDER]: { bg: "rgba(43,209,126,0.14)", border: "rgba(43,209,126,0.5)", text: "var(--color-accent-300)" },
  [TrustTier.SHIPPED]: { bg: "var(--color-accent)", border: "var(--color-accent)", text: "var(--color-accent-ink)", glow: "0 0 16px rgba(43,209,126,0.35)" },
};

const TRUST_LABELS: Record<string, string> = {
  LOCKED: "LOCK RECORDED",
  VERIFIED: "GITHUB LINKED",
  BUILDER: "ACTIVE BUILDER",
  SHIPPED: "PRODUCT SHIPPED",
  UNLOCKED: "LOCK ENDED",
};

const TIER_LABELS: Record<TrustTier, string> = {
  [TrustTier.LOCKED]: "LOCKED",
  [TrustTier.VERIFIED]: "VERIFIED",
  [TrustTier.BUILDER]: "BUILDER",
  [TrustTier.SHIPPED]: "SHIPPED",
};

export function getTrustBadgeLabel(label: string): string {
  return TRUST_LABELS[label.toUpperCase()] ?? label;
}

export function getTrustTierBadgeLabel(tier: TrustTier): string {
  return getTrustBadgeLabel(TIER_LABELS[tier]);
}

export default function Badge({ tier, label }: { tier: TrustTier; label: string }) {
  const s = TIER_STYLES[tier];
  return (
    <span
      className="inline-flex items-center gap-[4px] whitespace-nowrap rounded-md px-[9px] py-[4px] font-mono text-[10px] font-bold tracking-[0.08em]"
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text, boxShadow: s.glow }}
    >
      {tier >= TrustTier.VERIFIED && (
        <span className="h-1 w-1 rounded-full" style={{ background: s.text }} />
      )}
      {label}
    </span>
  );
}
