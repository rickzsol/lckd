import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Launch on Robinhood Chain",
  description: "Launch a fixed-supply token through Pons with permanent Uniswap v3 LP locking and post-confirmation verification.",
  alternates: { canonical: "/launch/robinhood" },
};

export default function RobinhoodLaunchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
