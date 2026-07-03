// app/manifest.ts
//
// Web-app manifest (2026-07-03 mobile pass). With app/apple-icon.png,
// this makes "Add to Home Screen" feel native: the sprout icon on the
// home screen and a standalone (no browser chrome) launch — the pitch
// for market vendors is "put it on your phone for market day."
//
// start_url is /dashboard: an installed app belongs to a signed-in
// vendor (unauthenticated hits just redirect to /signin). Colors from
// app/globals.css — oat page background, eucalyptus-dark brand green.

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dreamward",
    short_name: "Dreamward",
    description:
      "Real margin for makers who sell in person and online — every market, every channel, every product.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f7f4eb",
    theme_color: "#566b4e",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
