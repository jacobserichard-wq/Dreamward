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
import { isPayingTier, planDisplayLabel } from "@/lib/plans";

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

// Dropdown (`<details>`) styling. `summary` reuses the nav-link look but
// adds the chevron/gear affordance and hides the native disclosure
// marker. The panel is a white card; items read as a standard menu.
const SUMMARY_LINK =
  "bg-transparent text-white/75 text-[11px] sm:text-[13px] no-underline px-1 py-1.5 hover:text-white cursor-pointer inline-flex items-center gap-1 list-none [&::-webkit-details-marker]:hidden";
const MENU_PANEL =
  "absolute right-0 mt-2 z-30 bg-white rounded-xl shadow-lg border border-sand py-1.5 min-w-[180px] flex flex-col";
const MENU_ITEM =
  "px-4 py-2 text-sm text-bark hover:text-forest hover:bg-oat no-underline";

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
    <header className="bg-gradient-to-br from-eucalyptus-dark to-eucalyptus text-white px-4 sm:px-8 py-6">
      <div className="max-w-[1200px] mx-auto flex justify-between items-center">
        <Link href="/dashboard" className="no-underline text-white">
          <h1 className="m-0 text-2xl sm:text-[28px] font-semibold font-serif flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" aria-hidden="true">
              <path d="M12 22V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M12 13c-3.3 0-6-2.7-6-6 3.3 0 6 2.7 6 6Z" fill="currentColor" />
              <path d="M12 11c0-3.3 2.7-6 6-6 0 3.3-2.7 6-6 6Z" fill="currentColor" />
            </svg>
            Dreamward
          </h1>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
          {plan && (
            <a
              href="/billing"
              className="bg-white/15 text-white px-2 sm:px-4 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-[13px] font-semibold tracking-wider no-underline cursor-pointer"
            >
              {planDisplayLabel(plan)}
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

          {/* ── Daily-work surfaces (primary) ─────────────────────
              Transactions deep-links to the dashboard's processed view
              (June 2026 IA). */}
          <Link href="/dashboard?view=transactions" className={NAV_LINK}>
            <span>{"\u{1F4C4}"}</span> Transactions
          </Link>
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
          <Link href="/events" className={NAV_LINK}>
            Events
          </Link>
          {/* Market-day mode: phone-first booth sale logging. Paying. */}
          {paying && (
            <Link href="/market-day" className={NAV_LINK}>
              Market Day
            </Link>
          )}
          {paying && (
            <Link href="/reports" className={NAV_LINK}>
              Reports
            </Link>
          )}

          {/* ── Products dropdown ─────────────────────────────────
              SKUs + Inventory + COGS are one mental model (the product
              catalog), so they collapse into a single menu instead of
              three competing top-level links. */}
          {paying && (
            <details className="relative">
              <summary className={SUMMARY_LINK}>
                Products
                <Chevron />
              </summary>
              <div className={MENU_PANEL}>
                <Link
                  href="/skus"
                  className={MENU_ITEM}
                  title="Your product catalog — costs, stock, and recipes"
                >
                  SKUs
                </Link>
                <Link
                  href="/inventory"
                  className={MENU_ITEM}
                  title="Stock levels, value, and reorder alerts"
                >
                  Inventory
                </Link>
                <Link
                  href="/cogs"
                  className={MENU_ITEM}
                  title="Cost of goods sold + gross margin per channel and per SKU"
                >
                  COGS
                </Link>
              </div>
            </details>
          )}

          {/* ── Account menu ──────────────────────────────────────
              Settings / Billing / Integrations / Setup / Help / Sign
              out are account-admin, not daily work — folded into one
              gear menu so they don't each take a top-level slot. */}
          <details className="relative">
            <summary className={SUMMARY_LINK}>
              <GearIcon />
              Account
            </summary>
            <div className={MENU_PANEL}>
              <Link href="/settings" className={MENU_ITEM}>
                Settings
              </Link>
              <Link href="/billing" className={MENU_ITEM} title="Plan & billing">
                Billing
              </Link>
              <Link
                href="/integrations"
                className={MENU_ITEM}
                title="Connect Shopify and other platforms"
              >
                Integrations
              </Link>
              <Link
                href="/onboarding"
                className={MENU_ITEM}
                title="Open the setup checklist"
              >
                Setup
              </Link>
              <Link
                href="/help"
                className={MENU_ITEM}
                title="User guides and walkthroughs"
              >
                Help
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: "/signin" })}
                className={`${MENU_ITEM} text-left bg-transparent border-0 cursor-pointer w-full`}
              >
                Sign out
              </button>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" aria-hidden="true">
      <path
        d="M3 4.5 6 7.5 9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
