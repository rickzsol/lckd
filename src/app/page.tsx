import type { Metadata } from "next";
import Hero from "@/components/landing/Hero";
import WhyCards from "@/components/landing/WhyCards";
import FeatureRows from "@/components/landing/FeatureRows";
import ClosingCta from "@/components/landing/ClosingCta";

export const metadata: Metadata = {
  title: "Solana token launch workflow",
  description:
    "Create a Solana token with its Streamflow time lock in one atomic transaction. Review the finalized receipt independently.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "LCKD | Solana token launch workflow",
    description:
      "A transparent atomic create-and-lock workflow with public receipts.",
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
