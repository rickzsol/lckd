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
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "LCKD" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Launch a Token — LCKD",
    description:
      "Create a rug-proof token on Solana with enforced dev token locks.",
    images: ["/og.png"],
  },
};

export default function LaunchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
