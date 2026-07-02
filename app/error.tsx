// app/error.tsx
//
// Branded error boundary (2026-07-02 site review — previously the raw
// Next.js default). Client component per the error-file convention;
// receives the error + a reset() that re-renders the segment. The
// error itself is logged for diagnostics but never shown raw to the
// visitor.

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/support";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in the browser console + Vercel logs via the client
    // report; digest correlates with the server-side log entry.
    console.error("App error boundary:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-oat font-sans text-forest flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <p className="text-xs uppercase tracking-widest text-stone m-0 mb-3">
          Something went wrong
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold m-0 mb-3 leading-tight">
          That didn&apos;t work — but your data is safe.
        </h1>
        <p className="text-base text-bark m-0 mb-8 leading-relaxed">
          An unexpected error interrupted the page. Trying again usually
          fixes it. If it keeps happening, email{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-eucalyptus-dark underline hover:text-forest"
          >
            {SUPPORT_EMAIL}
          </a>
          {error.digest ? (
            <>
              {" "}
              and mention code{" "}
              <code className="text-sm bg-cream border border-sand rounded px-1.5 py-0.5">
                {error.digest}
              </code>
            </>
          ) : null}
          .
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
          <button
            onClick={reset}
            className="py-2.5 px-6 rounded-full bg-eucalyptus text-cream text-sm font-semibold border-0 cursor-pointer hover:bg-eucalyptus-dark"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-eucalyptus-dark no-underline hover:text-forest"
          >
            Back to your dashboard &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
