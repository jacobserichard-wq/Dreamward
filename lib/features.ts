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

  /** Shopify shop sync. TRUE since 2026-07-21 — flipped ahead of App
   *  Store review because the reviewer exercises the connect flow
   *  BEFORE approval, and the cold-install handoff (commit d420d08)
   *  lands on /integrations where this card must exist. Dev-store
   *  installs work with the flag on; a real (non-development) store
   *  CANNOT install until distribution is chosen + the listing is
   *  approved, so a real user clicking Connect pre-approval sees a
   *  Shopify-side error — acceptable while the only real user is on
   *  Etsy. On approval: restore the live-sync marketing copy (it was
   *  edited out 2026-07-03; grep SHOPIFY_ENABLED for breadcrumbs). */
  SHOPIFY_ENABLED: true,

  /** Wix shop sync. false since 2026-07-03: the Wix app exists (App ID
   *  96fcca2e…, still named "My New App-0") but is NOT published to the
   *  Wix App Market, so it isn't self-serve installable. App Market
   *  publishing (~weeks) is the path. Same gating shape as Shopify:
   *  connect card + bulk-import tab hidden, Coming-soon card shown,
   *  backend + WixConnectionCard dormant. Flip to true once published. */
  WIX_ENABLED: false,

  /** Plaid bank feed. TRUE (LIVE) since 2026-07-05 — Jacob's real Chase
   *  account connected cleanly end-to-end in production: OAuth redirect
   *  flow works (Link → Chase login → back → Connected), plaid_items row
   *  active/production/success, Compliance Center "Up to date". The earlier
   *  reCAPTCHA loop (Plaid limited-production fraud gate) lifted once the
   *  Compliance Center registration was submitted. Import is EXPENSES-ONLY:
   *  debits only, skips pending + deposits (verified lib/plaid.syncTransactions
   *  L267-268) so bank deposits never double-count platform payouts as income.
   *  Per-connection Plaid billing now applies (~$0.30/account/mo). If Plaid
   *  ever regresses to the reCAPTCHA/limited gate, flip back to false. */
  PLAID_ENABLED: true,
} as const;
