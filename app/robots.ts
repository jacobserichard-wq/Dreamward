// app/robots.ts
//
// Robots policy, served at /robots.txt (special metadata route —
// previously a 404). Public marketing pages are crawlable; the
// authenticated app + API surface is not. Points crawlers at the
// sitemap so the /compare/* and /for/* SEO pages get discovered.

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/dashboard",
        "/admin",
        "/billing",
        "/settings",
        "/expenses",
        "/integrations",
        "/onboarding",
        "/transactions",
        "/inventory",
        "/invoices",
        "/reports",
        "/events",
        "/market-day",
        "/profitability",
        "/welcome-pro",
      ],
    },
    sitemap: "https://godreamward.com/sitemap.xml",
  };
}
