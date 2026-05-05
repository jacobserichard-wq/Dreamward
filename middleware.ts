// Middleware uses NextAuth's `withAuth` helper. The matcher below is the
// authoritative list of protected routes. Anything not listed is public.
//
// Public by intentional omission:
//   /signin            — the sign-in page itself
//   /api/auth/*        — NextAuth callbacks (sign-in/sign-out flow)
//   /api/test-email    — diagnostic endpoint, kept reachable for debugging
//   /api/cron          — invoked by Vercel Cron with Bearer ${CRON_SECRET}
//   /api/stripe/webhook — invoked by Stripe with stripe-signature header
//
// If you add a new route that needs to be public (no NextAuth session),
// leave it OUT of the matcher. If you add a new route that needs auth,
// add it explicitly below.

export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    // Pages
    "/",
    "/admin/:path*",
    "/billing/:path*",
    "/onboarding/:path*",
    "/settings/:path*",
    "/welcome-pro/:path*",

    // Authenticated API routes
    "/api/admin/:path*",
    "/api/billing/:path*",
    "/api/client/:path*",
    "/api/gmail/:path*",
    "/api/items/:path*",
    "/api/onboarding/:path*",
    "/api/process/:path*",
    "/api/sample-data/:path*",
    "/api/settings/:path*",
    "/api/stripe/checkout/:path*",
    "/api/stripe/portal/:path*",
    "/api/upload/:path*",
  ],
};
