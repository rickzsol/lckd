import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Launch a Token — trudev.fun",
  description:
    "Create a token on pump.fun with enforced Streamflow vesting locks. Verified devs, locked bags, on-chain proof.",
  openGraph: {
    title: "Launch a Token — trudev.fun",
    description:
      "Create a rug-proof token on Solana with enforced dev vesting locks.",
    siteName: "trudev.fun",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Launch a Token — trudev.fun",
    description:
      "Create a rug-proof token on Solana with enforced dev vesting locks.",
  },
};

export default function LaunchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
