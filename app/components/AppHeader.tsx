// app/components/AppHeader.tsx
//
// Sub-session 33: shared top navigation bar. Extracted from the
// dashboard's inline header so the full nav (Upload, section links,
// Help, Settings, Sign out) appears on every page, not just the
// dashboard.
//
// Adoption:
//   - Dashboard passes plan + onUploadFile + uploading so its
//     Upload entry stays an inline file picker (the CSV review
//     modal lives on the dashboard).
//   - Inner pages render <AppHeader /> with no props — the
//     component self-fetches the plan from /api/client and the
//     Upload entry becomes a link to /dashboard (where the review
//     modal is).
//
// Client component: signOut, the file input, and the self-fetch
// all need the browser.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import Spinner from "./Spinner";
import { isPayingTier } from "@/lib/plans";

export interface AppHeaderProps {
  /** Current plan. When omitted, AppHeader fetches it from
   *  /api/client itself (drop-in for inner pages). */
  plan?: string | null;
  /** When provided, the Upload entry is an inline file picker
   *  (dashboard). When omitted, Upload links to /dashboard. */
  onUploadFile?: (file: File) => void;
  /** Spinner state for the inline upload (dashboard only). */
  uploading?: boolean;
}

const NAV_LINK =
  "bg-transparent text-white/75 text-[11px] sm:text-[13px] no-underline px-1 py-1.5 hover:text-white";

export default function AppHeader({
  plan: planProp,
  onUploadFile,
  uploading,
}: AppHeaderProps) {
  // Self-fetch the plan only when the parent didn't supply it.
  const [fetchedPlan, setFetchedPlan] = useState<string | null>(null);
  useEffect(() => {
    if (planProp !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/client");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setFetchedPlan(data.plan ?? null);
      } catch {
        // best-effort — nav still renders, paying-only links hidden
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planProp]);

  const plan = planProp !== undefined ? planProp : fetchedPlan;
  const paying = isPayingTier(plan);

  return (
    <header className="bg-gradient-to-br from-slate-800 to-slate-700 text-white px-4 sm:px-8 py-6">
      <div className="max-w-[1200px] mx-auto flex justify-between items-center">
        <Link href="/dashboard" className="no-underline text-white">
          <h1 className="m-0 text-2xl sm:text-[28px] font-bold">
            <span className="text-2xl">{"⚡"}</span> Dreamward
          </h1>
          <p className="mt-1 mb-0 mx-0 text-white/70 text-sm hidden sm:block">
            Accounting Automation
          </p>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
          {plan && (
            <a
              href="/billing"
              className="bg-white/15 text-white px-2 sm:px-4 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-[13px] font-semibold uppercase tracking-wider no-underline cursor-pointer"
            >
              {plan}
            </a>
          )}

          {/* Upload: inline file picker on the dashboard (onUploadFile
              provided); a link to /dashboard everywhere else, since
              the CSV review modal lives there. */}
          {onUploadFile ? (
            <label
              className={`${NAV_LINK} inline-flex items-center gap-1 m-0 ${
                uploading
                  ? "opacity-50 cursor-not-allowed"
                  : "cursor-pointer"
              }`}
              title="Upload a CSV, TSV, or XLSX file"
            >
              {uploading ? (
                <Spinner size={11} color="white" />
              ) : (
                <span>{"\u{1F4C1}"}</span>
              )}
              {uploading ? "Uploading..." : "Upload"}
              <input
                type="file"
                accept=".csv,.tsv,.xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadFile(f);
                  e.target.value = "";
                }}
                disabled={uploading}
              />
            </label>
          ) : (
            <Link
              href="/dashboard"
              className={`${NAV_LINK} inline-flex items-center gap-1`}
              title="Upload a file from the dashboard"
            >
              <span>{"\u{1F4C1}"}</span> Upload
            </Link>
          )}

          {/* Fable-5 audit: the "(template)" nav link read like a bug
              as global chrome. The CSV template is still linked from
              the dashboard upload hint, the Help hub, the
              getting-started guide, and the SKUs tip. */}
          <Link href="/events" className={NAV_LINK}>
            Events
          </Link>
          {/* Market-day mode: phone-first booth sale logging. Gated
              like the other paying-tier surfaces. */}
          {paying && (
            <Link href="/market-day" className={NAV_LINK}>
              Market Day
            </Link>
          )}
          <Link href="/expenses" className={NAV_LINK}>
            Expenses
          </Link>
          <Link
            href="/invoices"
            className={NAV_LINK}
            title="Accounts Receivable — customer invoices awaiting payment"
          >
            AR
          </Link>
          {paying && (
            <Link
              href="/skus"
              className={NAV_LINK}
              title="Your product catalog — costs, stock, and recipes"
            >
              SKUs
            </Link>
          )}
          {paying && (
            <Link
              href="/inventory"
              className={NAV_LINK}
              title="Stock levels, value, and reorder alerts"
            >
              Inventory
            </Link>
          )}
          {paying && (
            <Link
              href="/cogs"
              className={NAV_LINK}
              title="Cost of goods sold + gross margin per channel and per SKU"
            >
              COGS
            </Link>
          )}
          {paying && (
            <Link href="/reports" className={NAV_LINK}>
              Reports
            </Link>
          )}
          <Link
            href="/onboarding"
            className={NAV_LINK}
            title="Open the setup checklist"
          >
            Setup
          </Link>
          <Link
            href="/integrations"
            className={NAV_LINK}
            title="Connect Shopify and other platforms"
          >
            Integrations
          </Link>
          <Link href="/help" className={NAV_LINK} title="User guides and walkthroughs">
            Help
          </Link>
          <Link href="/settings" className={NAV_LINK}>
            Settings
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: "/signin" })}
            className="bg-transparent text-white/75 text-[11px] sm:text-[13px] cursor-pointer px-1 py-1.5 hover:text-white border-0"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
