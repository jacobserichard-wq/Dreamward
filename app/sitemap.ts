// app/sitemap.ts
//
// Sitemap for the public marketing surface. Next serves this at
// /sitemap.xml (special metadata route — previously a 404, which left
// Google to stumble onto the SEO pages on its own).
//
// Keep this list in sync when adding /for/* industry pages or
// /compare/* competitor pages — those exist to rank, and an entry here
// is how crawlers find them. Authenticated app routes stay out (they're
// behind sign-in and disallowed in robots.ts anyway).

import type { MetadataRoute } from "next";

const BASE = "https://godreamward.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: Array<{
    path: string;
    priority: number;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  }> = [
    { path: "/", priority: 1, changeFrequency: "weekly" },
    { path: "/pricing", priority: 0.9, changeFrequency: "monthly" },
    { path: "/how-it-works", priority: 0.8, changeFrequency: "monthly" },
    { path: "/compare", priority: 0.8, changeFrequency: "monthly" },
    { path: "/compare/craftybase", priority: 0.8, changeFrequency: "monthly" },
    { path: "/compare/spreadsheets", priority: 0.7, changeFrequency: "monthly" },
    {
      path: "/for/farmers-market-vendors",
      priority: 0.8,
      changeFrequency: "monthly",
    },
    { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
    { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
  ];

  return pages.map((p) => ({
    url: `${BASE}${p.path === "/" ? "" : p.path}`,
    lastModified: new Date(),
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
