import type { Metadata } from "next";
import MatchClient from "./MatchClient";

export const metadata: Metadata = {
  title: "Matched launches",
  description: "Apply to have LCKD match your dev buy and lock alongside you.",
};

export default function MatchPage() {
  return <MatchClient />;
}
