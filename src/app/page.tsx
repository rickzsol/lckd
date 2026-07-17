import type { Metadata } from "next";
import Hero from "@/components/landing/Hero";
import WhyCards from "@/components/landing/WhyCards";
import FeatureRows from "@/components/landing/FeatureRows";
import ClosingCta from "@/components/landing/ClosingCta";

export const metadata: Metadata = {
  title: "Solana token launch workflow",
  description:
    "Create a Solana token, confirm it on-chain, then approve a separate Streamflow token lock. Review both transaction receipts independently.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "LCKD | Solana token launch workflow",
    description:
      "A transparent create-then-lock workflow with separate wallet approvals and public receipts.",
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
