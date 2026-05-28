// Next 16 renamed the `middleware.ts` file convention to `proxy.ts`. NextAuth's
// `withAuth` is itself the middleware function — it conforms to the same
// (req, event) signature Next expects. We import it explicitly and re-export
// as default; the older `export { default } from "next-auth/middleware"`
// pattern is not recognized by Next 16's Turbopack analyzer as a function.
//
// The matcher below is the authoritative list of protected routes. Anything
// not listed is public.
//
// Public by intentional omission:
//   /                  — marketing landing page (sub-session 24 flow redesign)
//                        Authenticated users get a server-side redirect to
//                        /dashboard from inside the page itself.
//   /signin            — the sign-in page itself
//   /privacy           — privacy policy, must be reachable to anonymous users
//                        (Google OAuth review and end-user review require this)
//   /terms             — terms of service, same reasoning as /privacy
//   /api/auth/*        — NextAuth callbacks (sign-in/sign-out flow)
//   /api/test-email    — diagnostic endpoint, kept reachable for debugging
//   /api/cron          — invoked by Vercel Cron with Bearer ${CRON_SECRET}
//   /api/stripe/webhook — invoked by Stripe with stripe-signature header
//   /api/shopify/oauth/callback — Shopify redirects merchants here after
//                                 they install the FlowWork app. No
//                                 NextAuth session at the moment of the
//                                 hit (Shopify is the referrer); the route
//                                 itself checks session + CSRF state +
//                                 Shopify HMAC. Phase 8a sub-session 24.
//   /api/shopify/webhook — invoked by Shopify with X-Shopify-Hmac-SHA256
//                          header; route verifies the signature. Phase 8d.
//   /api/wix/installed — Wix POSTs the app-installed webhook here
//                        after a merchant installs FlowWork on their
//                        Wix site. JWT-signed (signature verification
//                        is TODO — Wix's public key isn't exposed in
//                        Custom Apps' Dev Center UI). Route does a
//                        soft iss='wix.com' claim check + email
//                        matching against the clients table to bind
//                        instance_id → client_id. This is the PRIMARY
//                        binding path for Phase 10 since Custom Apps
//                        don't support post-install redirect URL
//                        configuration. See session-notes/
//                        phase-10-wix-email-matching.md.
//   /api/wix/webhook — future Phase 10d, additional Wix webhooks for
//                      real-time order sync.
//
// If you add a new route that needs to be public, leave it OUT of the matcher.
// If you add a new route that needs auth, add it explicitly below.

import withAuth from "next-auth/middleware";

export default withAuth;

export const config = {
  matcher: [
    // Pages
    "/dashboard/:path*",
    "/admin/:path*",
    "/billing/:path*",
    "/expenses/:path*",
    "/integrations/:path*",
    "/onboarding/:path*",
    "/settings/:path*",
    "/welcome-pro/:path*",

    // Authenticated API routes
    "/api/admin/:path*",
    "/api/billing/:path*",
    "/api/client/:path*",
    "/api/expenses/:path*",
    "/api/gmail/:path*",
    "/api/items/:path*",
    "/api/onboarding/:path*",
    "/api/process/:path*",
    "/api/profitability/:path*",
    "/api/sample-data/:path*",
    "/api/settings/:path*",
    "/api/shopify/backfill/:path*",
    "/api/shopify/connection/:path*",
    "/api/shopify/disconnect/:path*",
    "/api/shopify/oauth/initiate/:path*",
    "/api/shopify/upgrade-backfill/:path*",
    "/api/stripe/checkout/:path*",
    "/api/stripe/portal/:path*",
    "/api/upload/:path*",
    "/api/wix/backfill/:path*",
    "/api/wix/bind/:path*",
    "/api/wix/connection/:path*",
    "/api/wix/disconnect/:path*",
  ],
};
