import { notFound } from "next/navigation";
import DemoClient from "./DemoClient";

export const metadata = {
  title: "Design demo",
  robots: { index: false, follow: false },
};

export default function DemoPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DemoClient />;
}
