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
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "LCKD" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "LCKD — Builders who ship. Tokens that lock.",
    description:
      "Launch tokens where devs can't rug. Every dev allocation is locked via Streamflow token lock.",
    images: ["/og.png"],
  },
};

export default function Home() {
  return <TokenShowcase />;
}
