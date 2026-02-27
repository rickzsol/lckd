import type { Metadata } from "next";
import TokenShowcase from "@/components/landing/TokenShowcase";

export const metadata: Metadata = {
  title: "LCKD — Builders who ship. Tokens that lock.",
  description:
    "Launch Solana tokens with enforced token locks. Ship code, lock tokens, prove it. Built on pump.fun + Streamflow.",
  openGraph: {
    title: "LCKD — Builders who ship. Tokens that lock.",
    description:
      "Launch tokens where devs can't rug. Every dev allocation is locked via Streamflow token lock.",
    siteName: "LCKD",
    type: "website",
  },
};

export default function Home() {
  return <TokenShowcase />;
}
