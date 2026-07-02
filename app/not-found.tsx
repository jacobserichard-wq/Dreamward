// app/not-found.tsx
//
// Branded 404 (2026-07-02 site review — previously the raw Next.js
// default). Kept deliberately light: brand mark, plain-English line,
// and routes back to the pages a lost visitor actually wants.

import Link from "next/link";

export const metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-oat font-sans text-forest flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <SproutMark className="w-10 h-10 text-eucalyptus mx-auto mb-5" />
        <p className="text-xs uppercase tracking-widest text-stone m-0 mb-3">
          404 — page not found
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold m-0 mb-3 leading-tight">
          That page isn&apos;t here.
        </h1>
        <p className="text-base text-bark m-0 mb-8 leading-relaxed">
          The link may be old, or the page may have moved. Your numbers
          are fine — they&apos;re just not on this page.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
          <Link
            href="/"
            className="inline-block py-2.5 px-6 rounded-full bg-eucalyptus text-cream text-sm font-semibold no-underline hover:bg-eucalyptus-dark"
          >
            Back to the homepage
          </Link>
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-eucalyptus-dark no-underline hover:text-forest"
          >
            Go to your dashboard &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}

function SproutMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 22V10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M12 13c-3.3 0-6-2.7-6-6 3.3 0 6 2.7 6 6Z" fill="currentColor" />
      <path d="M12 11c0-3.3 2.7-6 6-6 0 3.3-2.7 6-6 6Z" fill="currentColor" />
    </svg>
  );
}
