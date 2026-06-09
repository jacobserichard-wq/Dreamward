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
} as const;
