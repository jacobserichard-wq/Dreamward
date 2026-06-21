// app/components/DashboardBankCard.tsx
//
// Dashboard "Bank accounts" section (Phase 2). Read-only summary of the
// client's connected Plaid items — the cash-out side of the books, shown
// next to the revenue Channels. Self-fetches the bank list from
// /api/plaid/items; the imported / needs-review counts come from the
// dashboard's already-loaded processedItems (passed as props) so we don't
// double-fetch. Connect / manage lives on /integrations.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PlaidBank {
  id: number;
  itemId: string;
  institutionName: string | null;
  status: string;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  environment: string;
}

function syncLabel(b: PlaidBank): string {
  if (!b.lastSyncAt) return "No sync yet";
  const d = new Date(b.lastSyncAt);
  return `Synced ${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

export default function DashboardBankCard({
  importedCount,
  needsReviewCount,
}: {
  importedCount: number;
  needsReviewCount: number;
}) {
  const [banks, setBanks] = useState<PlaidBank[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/plaid/items");
        if (!res.ok) {
          if (!cancelled) setBanks([]);
          return;
        }
        const data = await res.json();
        if (!cancelled) setBanks(data.items ?? []);
      } catch {
        if (!cancelled) setBanks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="text-lg font-bold text-slate-900 m-0 flex items-center gap-2">
          <span aria-hidden>{"\u{1F3E6}"}</span> Bank accounts
        </h3>
        <Link
          href="/integrations"
          className="text-xs text-blue-600 hover:underline whitespace-nowrap"
        >
          Manage {"\u{2192}"}
        </Link>
      </div>
      <p className="text-xs text-slate-500 m-0 mb-4">
        Expenses auto-imported from your bank.
      </p>

      {banks === null ? (
        // Loading skeleton
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-12 bg-slate-50 rounded animate-pulse" />
          ))}
        </div>
      ) : banks.length === 0 ? (
        // Empty state — no bank connected
        <div className="text-center py-6">
          <p className="text-sm text-slate-500 m-0 mb-3">
            Connect your bank to pull in business expenses automatically — no
            manual entry.
          </p>
          <Link
            href="/integrations"
            className="inline-flex items-center gap-1 py-2 px-4 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold no-underline"
          >
            {"\u{1F3E6}"} Connect a bank
          </Link>
        </div>
      ) : (
        <>
          <ul className="m-0 p-0 list-none divide-y divide-slate-100 mb-3">
            {banks.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="text-sm font-medium text-slate-800 flex items-center gap-2 min-w-0">
                  <span className="truncate">
                    {b.institutionName ?? "Bank"}
                  </span>
                  {b.environment === "sandbox" && (
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 uppercase tracking-wide flex-shrink-0">
                      Sandbox
                    </span>
                  )}
                  {b.status === "error" && (
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200 flex-shrink-0">
                      Reconnect
                    </span>
                  )}
                </span>
                <span className="text-xs text-slate-400 whitespace-nowrap">
                  {syncLabel(b)}
                </span>
              </li>
            ))}
          </ul>

          {/* Imported / needs-review summary */}
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 text-sm">
            <span className="text-slate-600">
              <span className="font-semibold text-slate-900 tabular-nums">
                {importedCount}
              </span>{" "}
              {importedCount === 1 ? "expense" : "expenses"} imported
            </span>
            {needsReviewCount > 0 ? (
              <Link
                href="/dashboard?view=transactions&filter=needs_review"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-medium no-underline hover:bg-indigo-100"
              >
                {"\u{1F440}"} {needsReviewCount} to review
              </Link>
            ) : (
              <span className="text-xs text-slate-400">All reviewed</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
