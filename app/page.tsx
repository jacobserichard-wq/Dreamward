// app/page.tsx
//
// Sub-session 24 flow redesign commit 1 of 9. Marketing landing
// stub. Commit 2 builds out the full hero + features + pricing.
// This file exists in commit 1 only so:
//   1. Next.js's type generator finds an app/page.tsx (without one,
//      the .next/types/validator.ts emits TS2307 errors)
//   2. The route move from app/page.tsx (dashboard) to
//      app/dashboard/page.tsx is testable in isolation — anyone
//      visiting / sees a placeholder, not a 404
//
// Per design §5 + locked decision #8: authenticated visitors get
// a server-side redirect to /dashboard. Bookmarks pointing at the
// old flowworks.it.com/ keep working seamlessly.

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";

export default async function MarketingLandingPage() {
  // Server-side auth check. Logged-in users never see the marketing
  // page — they go straight to /dashboard. Unauthenticated visitors
  // see the public marketing copy.
  const session = await getServerSession(authOptions);
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold text-slate-900 mb-3">
          {"\u{26A1}"} FlowWork
        </h1>
        <p className="text-slate-600 mb-6">
          Accounting automation for solo founders and small businesses.
        </p>
        <Link
          href="/signin"
          className="inline-block py-3 px-6 rounded-lg bg-blue-600 text-white text-sm font-semibold no-underline cursor-pointer"
        >
          Sign in to get started {"\u{2192}"}
        </Link>
        <p className="text-xs text-slate-400 mt-6">
          Full landing page lands in commit 2 of this arc.
        </p>
      </div>
    </div>
  );
}
