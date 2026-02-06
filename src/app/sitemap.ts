import type { MetadataRoute } from "next";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.trudev.fun";

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${baseUrl}/feed`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.9 },
    { url: `${baseUrl}/launch`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/docs`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
  ];

  // Add token pages from Supabase if available
  let tokenRoutes: MetadataRoute.Sitemap = [];
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (url && key) {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(url, key);
      const { data } = await supabase
        .from("tokens")
        .select("mint_address, created_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (data) {
        tokenRoutes = data.map((t: { mint_address: string; created_at: string }) => ({
          url: `${baseUrl}/token/${t.mint_address}`,
          lastModified: new Date(t.created_at),
          changeFrequency: "daily" as const,
          priority: 0.6,
        }));
      }
    }
  } catch {
    // Supabase unavailable — skip token routes
  }

  return [...staticRoutes, ...tokenRoutes];
}
