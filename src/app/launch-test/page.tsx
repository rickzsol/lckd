import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import LaunchPageClient from "@/app/launch/LaunchPageClient";
import { isLaunchTestUser } from "@/lib/launchAvailability";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function LaunchTestPage() {
  const session = await getServerSession(authOptions);
  if (!session?.github_id) {
    redirect("/api/auth/signin?callbackUrl=%2Flaunch-test");
  }
  if (!isLaunchTestUser(session.github_id)) notFound();
  return <LaunchPageClient callbackUrl="/launch-test" />;
}
