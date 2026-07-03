// lib/features.ts
//
// Sub-session 33 commit: centralized feature flags. One place to
// toggle work-in-progress or evaluation-mode features without
// hunting through component files.
//
// Keep this file small and pure — no imports, no runtime logic,
// just literal booleans. Anything more complex belongs in its own
// configuration layer.

export const FEATURES = {
  /** Gmail label-sweep ingestion. Hidden while we evaluate whether
   *  to keep the feature given the pivot to direct platform
   *  integrations (Shopify / Wix / Square). Routes + components +
   *  plan-tier labels + the "Forwarded invoices" channel definition
   *  stay intact so flipping this back to true re-enables everything
   *  with one deploy. See session-notes/audit-gmail-deprecation-and-
   *  video-tutorials.md for the decision context. */
  GMAIL_INGEST: false,

  /** Etsy shop sync. false since 2026-07-03: the Etsy developer app
   *  ("dreamward", keystring 1pl51hyo23r59iv1v49d6510) was BANNED by
   *  Etsy, so OAuth + every Etsy API call fail. With this false the
   *  /integrations card and the bulk-import "Etsy" tab are hidden and
   *  Etsy shows only as a "Coming soon" card — nothing points a user at
   *  a dead connector. Marketing copy that claimed live Etsy sync was
   *  edited out at the same time (grep ETSY_ENABLED for breadcrumbs).
   *  Backend routes (app/api/etsy/*) + EtsyConnectionCard.tsx stay in
   *  place, dormant. To re-enable after Etsy reinstates (or a new app
   *  clears Commercial access): flip to true, restore the copy, and
   *  point ETSY_API_KEY / ETSY_SHARED_SECRET (Vercel) at the live app.
   *  See session-notes/launch-checklist.md. */
  ETSY_ENABLED: false,
} as const;
