import type { MetadataRoute } from "next";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://lckd.tech";

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: baseUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/feed`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${baseUrl}/launch`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/docs`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/api-docs`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/risk`, changeFrequency: "monthly", priority: 0.6 },
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
    // Supabase unavailable, skip token routes
  }

  return [...staticRoutes, ...tokenRoutes];
}
