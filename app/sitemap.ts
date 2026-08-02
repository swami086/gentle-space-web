import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { CORRIDORS } from "@/lib/corridors";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/spaces`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
  ];

  const corridorRoutes: MetadataRoute.Sitemap = CORRIDORS.map((c) => ({
    url: `${SITE_URL}/bangalore/${c.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [...staticRoutes, ...corridorRoutes];
}
