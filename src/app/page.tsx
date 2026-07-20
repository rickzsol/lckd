import type { Metadata } from "next";
import Hero from "@/components/landing/Hero";
import WhyCards from "@/components/landing/WhyCards";
import FeatureRows from "@/components/landing/FeatureRows";
import ClosingCta from "@/components/landing/ClosingCta";

export const metadata: Metadata = {
  title: "Solana token launch workflow",
  description:
    "Launch a Solana token with or without a Streamflow lock. Sign in with X or GitHub and review the finalized receipt.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "LCKD | Solana token launch workflow",
    description:
      "Launch with an optional token lock and a public on-chain receipt.",
    url: "/",
    siteName: "LCKD",
    type: "website",
  },
};

export default function Home() {
  return (
    <>
      <Hero />
      <WhyCards />
      <FeatureRows />
      <ClosingCta />
    </>
  );
}
