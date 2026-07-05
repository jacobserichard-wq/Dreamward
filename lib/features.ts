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

  /** Shopify shop sync. false since 2026-07-03: the Shopify app exists
   *  (Client ID cd26fb7a…) but distribution was NEVER chosen — no App
   *  Store listing, 0 installs — so a stranger can't self-serve connect.
   *  App Store approval (~1-3 weeks) is in progress; the GDPR compliance
   *  webhooks + read_products scope it requires are already shipped
   *  (commits 4611134, fd7ad22). While false, the /integrations connect
   *  card + the bulk-import "Shopify" tab are hidden and Shopify shows
   *  only as a "Coming soon" card. Backend routes + ShopifyConnectionCard
   *  stay dormant. Flip to true once the App Store listing is approved. */
  SHOPIFY_ENABLED: false,

  /** Wix shop sync. false since 2026-07-03: the Wix app exists (App ID
   *  96fcca2e…, still named "My New App-0") but is NOT published to the
   *  Wix App Market, so it isn't self-serve installable. App Market
   *  publishing (~weeks) is the path. Same gating shape as Shopify:
   *  connect card + bulk-import tab hidden, Coming-soon card shown,
   *  backend + WixConnectionCard dormant. Flip to true once published. */
  WIX_ENABLED: false,

  /** Plaid bank feed. false since 2026-07-05. Production is configured
   *  and working end-to-end (PLAID_ENV=production, OAuth web flow, real
   *  banks list, link-token 200) — BUT the account is in Plaid's LIMITED
   *  "test with real data" production state. Connecting the major banks
   *  (Chase/BofA/Wells Fargo) requires completing Plaid's "Access OAuth
   *  institutions" registration in the Compliance Center (app name, logo,
   *  use-case) + a 2-4 WEEK per-institution review. Until that clears,
   *  real connections hit an unpassable reCAPTCHA/fraud gate, so the
   *  "Connect a bank" card is a dead-end. While false, the card is hidden
   *  and a "Coming soon" bank card shows instead. All Plaid code + the
   *  Vercel prod creds stay intact — flip to true the day Jacob's own
   *  bank connects cleanly. Consider reverting PLAID_ENV to sandbox in
   *  Vercel meanwhile so no accidental prod call is billable. */
  PLAID_ENABLED: false,
} as const;
