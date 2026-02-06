import type { Metadata } from "next";
import TokenShowcase from "@/components/landing/TokenShowcase";

export const metadata: Metadata = {
  title: "trudev.fun — Dev Bags Locked on Launch",
  description:
    "Launch Solana tokens with enforced vesting locks. Verified developers, locked bags, on-chain proof. Built on pump.fun + Streamflow.",
  openGraph: {
    title: "trudev.fun — Dev Bags Locked on Launch",
    description:
      "Launch tokens where devs can't rug. Every dev allocation is locked via Streamflow vesting.",
    siteName: "trudev.fun",
    type: "website",
  },
};

export default function Home() {
  return <TokenShowcase />;
}
