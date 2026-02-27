import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Launch a Token — LCKD",
  description:
    "Create a token on pump.fun with enforced Streamflow token locks. Verified devs, locked bags, on-chain proof.",
  openGraph: {
    title: "Launch a Token — LCKD",
    description:
      "Create a rug-proof token on Solana with enforced dev token locks.",
    siteName: "LCKD",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Launch a Token — LCKD",
    description:
      "Create a rug-proof token on Solana with enforced dev token locks.",
  },
};

export default function LaunchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
