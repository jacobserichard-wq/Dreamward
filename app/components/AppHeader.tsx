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

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { isPayingTier } from "@/lib/plans";

export interface AppHeaderProps {
  /** Current plan. When omitted, AppHeader fetches it from
   *  /api/client itself (drop-in for inner pages). */
  plan?: string | null;
}

// Primary nav link styling. The active (current) section gets a subtle
// white pill so you can see where you are; inactive links are dimmed.
const NAV_BASE =
  "bg-transparent text-[11px] sm:text-[13px] no-underline py-1.5";
const NAV_LINK = `${NAV_BASE} px-1 text-white/75 hover:text-white`;
const NAV_ACTIVE = `${NAV_BASE} px-2.5 rounded-full bg-white/15 text-white font-semibold`;

// Dropdown (`<details>`) styling. `summary` reuses the nav-link look but
// adds the chevron/gear affordance and hides the native disclosure
// marker. The panel is a white card; items read as a standard menu.
const SUMMARY_BASE =
  "bg-transparent text-[11px] sm:text-[13px] no-underline py-1.5 cursor-pointer inline-flex items-center gap-1 list-none [&::-webkit-details-marker]:hidden";
const SUMMARY_LINK = `${SUMMARY_BASE} px-1 text-white/75 hover:text-white`;
const SUMMARY_ACTIVE = `${SUMMARY_BASE} px-2.5 rounded-full bg-white/15 text-white font-semibold`;
const MENU_PANEL =
  "absolute right-0 mt-2 z-30 bg-white rounded-xl shadow-lg border border-sand py-1.5 min-w-[180px] flex flex-col";
const MENU_ITEM =
  "px-4 py-2 text-sm text-bark hover:text-forest hover:bg-oat no-underline";

export default function AppHeader({ plan: planProp }: AppHeaderProps) {
  // Self-fetch the plan only when the parent didn't supply it.
  const [fetchedPlan, setFetchedPlan] = useState<string | null>(null);
  // Ref to the nav container so a document-level click can close any
  // open <details> menu when the click lands outside it.
  const navRef = useRef<HTMLDivElement>(null);
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

  const pathname = usePathname();
  // Track the query string client-side so the Home (overview) tab and the
  // Transactions tab can be told apart — both live at /dashboard,
  // distinguished only by ?view=transactions. usePathname() drops the
  // query, and useSearchParams() would force a Suspense boundary on every
  // page that renders this shared header. Reading window.location in an
  // effect that runs each render avoids both: AppHeader re-renders when
  // the dashboard view changes, so the effect re-reads and the pill stays
  // in sync. setState is guarded so it only re-renders on an actual change.
  const [search, setSearch] = useState("");
  useEffect(() => {
    const s = window.location.search;
    setSearch((prev) => (prev === s ? prev : s));
  });

  // Current-section highlight. Transactions deep-links to
  // /dashboard?view=transactions, so /dashboard counts as its section.
  const isActive = (href: string) => {
    const path = href.split("?")[0];
    if (path === "/dashboard") return pathname === "/dashboard";
    return pathname === path || pathname.startsWith(path + "/");
  };
  // Home = the overview; Transactions = the same route with ?view=
  // transactions. Split them on the tracked query so only one pill lights.
  const onDashboard = pathname === "/dashboard";
  const transactionsView = search.includes("view=transactions");
  const homeActive = onDashboard && !transactionsView;
  const transactionsActive = onDashboard && transactionsView;
  const productsActive =
    isActive("/skus") || isActive("/inventory") || isActive("/cogs");
  const accountActive =
    isActive("/settings") ||
    isActive("/billing") ||
    isActive("/integrations") ||
    isActive("/onboarding") ||
    isActive("/help");

  // Click-outside / Escape to close the dropdown menus. Native <details>
  // stays open until its summary is clicked again; this makes it behave
  // like a normal menu. Any click except on a menu's own <summary>
  // closes any open menu (so clicking a menu item, another menu's
  // summary, or empty space all dismiss it); the summary is left to the
  // native toggle.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const nav = navRef.current;
      if (!nav) return;
      const target = e.target as Node;
      nav.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((d) => {
        const summary = d.querySelector("summary");
        if (summary && summary.contains(target)) return;
        d.open = false;
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      navRef.current
        ?.querySelectorAll<HTMLDetailsElement>("details[open]")
        .forEach((d) => {
          d.open = false;
        });
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <header className="bg-gradient-to-br from-eucalyptus-dark to-eucalyptus text-white px-4 sm:px-8 py-6">
      <div className="max-w-[1200px] mx-auto flex items-center justify-between sm:justify-start sm:gap-10">
        {/* Plain <a>, not next/link: a full navigation to /dashboard
            guarantees the overview renders. A soft <Link> nav that only
            strips the ?view=transactions param didn't reliably refresh
            the in-page view in Next 16, so the logo could land on the
            Transactions view. The logo is the "go home" reset — a clean
            load is the right behavior here. */}
        <a href="/dashboard" className="no-underline text-white">
          <h1 className="m-0 text-2xl sm:text-[28px] font-semibold font-serif flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" aria-hidden="true">
              <path d="M12 22V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M12 13c-3.3 0-6-2.7-6-6 3.3 0 6 2.7 6 6Z" fill="currentColor" />
              <path d="M12 11c0-3.3 2.7-6 6-6 0 3.3-2.7 6-6 6Z" fill="currentColor" />
            </svg>
            Dreamward
          </h1>
        </a>
        <div ref={navRef} className="flex items-center gap-2 sm:gap-3 flex-wrap justify-start">
          {/* Plan badge removed — current plan + trial status live on the
              Billing page (Account → Billing). */}

          {/* Upload moved into the Transactions view (June 2026) — it's a
              button alongside Add-a-sale / New-expense there, no longer a
              separate nav entry. */}

          {/* Desktop nav — inline links + dropdowns, sm and up. On
              phones this whole block hides and the hamburger below
              takes over, so the header stays one tidy row. */}
          <div className="hidden sm:flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* ── Daily-work surfaces (primary) ─────────────────────
              Home is the overview dashboard. Plain <a>, matching the logo:
              a full load reliably resets to the overview (a soft nav that
              only strips ?view=transactions didn't refresh the in-page
              view in Next 16). Transactions deep-links to the dashboard's
              processed view (June 2026 IA). */}
          <a
            href="/dashboard"
            className={homeActive ? NAV_ACTIVE : NAV_LINK}
            title="Overview dashboard"
          >
            Home
          </a>
          <Link
            href="/dashboard?view=transactions"
            className={transactionsActive ? NAV_ACTIVE : NAV_LINK}
          >
            Transactions
          </Link>
          {/* ── My Products dropdown ──────────────────────────────
              SKUs + Inventory + COGS are one mental model (the product
              catalog), so they collapse into a single menu instead of
              three competing top-level links. */}
          {paying && (
            <details className="relative">
              <summary className={productsActive ? SUMMARY_ACTIVE : SUMMARY_LINK}>
                My Products
                <Chevron />
              </summary>
              <div className={MENU_PANEL}>
                <Link
                  href="/inventory"
                  className={MENU_ITEM}
                  title="Stock levels, value, and reorder alerts"
                >
                  Inventory
                </Link>
                <Link
                  href="/skus"
                  className={MENU_ITEM}
                  title="Your product catalog — costs, stock, and recipes"
                >
                  SKUs &amp; Components
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
          <Link
            href="/events"
            className={isActive("/events") ? NAV_ACTIVE : NAV_LINK}
          >
            Events
          </Link>
          <Link
            href="/invoices"
            className={isActive("/invoices") ? NAV_ACTIVE : NAV_LINK}
            title="Accounts Receivable — customer invoices awaiting payment"
          >
            AR
          </Link>
          {/* Market Day moved off the global nav onto the Events page —
              it only works in the context of an event. */}
          {paying && (
            <Link
              href="/reports"
              className={isActive("/reports") ? NAV_ACTIVE : NAV_LINK}
            >
              Reports
            </Link>
          )}

          {/* ── Account menu ──────────────────────────────────────
              Settings / Billing / Integrations / Setup / Help / Sign
              out are account-admin, not daily work — folded into one
              gear menu so they don't each take a top-level slot. */}
          <details className="relative">
            <summary className={accountActive ? SUMMARY_ACTIVE : SUMMARY_LINK}>
              <GearIcon />
              Account
              <Chevron />
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

          {/* Mobile nav — everything collapses into one hamburger below
              sm, so phones get a single clean header row instead of a
              wrapped pile of links. */}
          <details className="sm:hidden relative">
            <summary className={SUMMARY_LINK} aria-label="Menu">
              <BarsIcon />
            </summary>
            <div className={MENU_PANEL}>
              {/* Plain <a> — same reliable overview reset as the logo. */}
              <a href="/dashboard" className={MENU_ITEM}>
                Home
              </a>
              <Link href="/dashboard?view=transactions" className={MENU_ITEM}>
                Transactions
              </Link>
              {/* My Products */}
              {paying && (
                <Link href="/inventory" className={MENU_ITEM}>
                  Inventory
                </Link>
              )}
              {paying && (
                <Link href="/skus" className={MENU_ITEM}>
                  SKUs &amp; Components
                </Link>
              )}
              {paying && (
                <Link href="/cogs" className={MENU_ITEM}>
                  COGS
                </Link>
              )}
              <Link href="/events" className={MENU_ITEM}>
                Events
              </Link>
              <Link href="/invoices" className={MENU_ITEM}>
                AR
              </Link>
              {paying && (
                <Link href="/reports" className={MENU_ITEM}>
                  Reports
                </Link>
              )}
              <div className="my-1 border-t border-sand" />
              <Link href="/settings" className={MENU_ITEM}>
                Settings
              </Link>
              <Link href="/billing" className={MENU_ITEM}>
                Billing
              </Link>
              <Link href="/integrations" className={MENU_ITEM}>
                Integrations
              </Link>
              <Link href="/onboarding" className={MENU_ITEM}>
                Setup
              </Link>
              <Link href="/help" className={MENU_ITEM}>
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

function BarsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
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
