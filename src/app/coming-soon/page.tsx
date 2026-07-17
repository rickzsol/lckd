import type { Metadata } from "next";
import AccessGate from "./AccessGate";

export const metadata: Metadata = {
  title: "Coming soon",
  robots: { index: false, follow: false },
};

export default function ComingSoonPage() {
  return <AccessGate />;
}
