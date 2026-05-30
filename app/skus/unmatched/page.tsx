// app/skus/unmatched/page.tsx
//
// Phase 12d commit 2 of 5. The Unmatched Items page — surfaces
// every line item across every connected platform that doesn't
// have a SKU mapping yet, grouped so duplicates collapse.
//
// Commit 2 ships the list view only. Bulk-match actions
// ("Create new SKU", "Map to existing SKU") arrive in commit 3.
//
// Anti-Crafty positioning (in-app, per user spec):
//   - Page subtitle calls out that mapping here retroactively
//     resolves every historical sale of the item (Crafty Base
//     can't do this — their users have to re-import).
//   - Square Custom Amount items get an explicit info banner
//     because they're Crafty Base's #1 complaint and we handle
//     them as first-class data, not an edge case.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "../../components/PageHeader";
import ErrorBanner from "../../components/ErrorBanner";

interface UnmatchedItem {
  platform: string;
  externalItemId: string | null;
  externalSku: string | null;
  name: string;
  lineItemCount: number;
  totalRevenue: number;
  lastSoldAt: string;
  groupKey: string;
}

interface PlatformCount {
  groupCount: number;
  lineItemCount: number;
}

interface UnmatchedResponse {
  items: UnmatchedItem[];
  summary: {
    totalGroups: number;
    totalLineItems: number;
    totalRevenue: number;
    byPlatform: Record<string, PlatformCount>;
  };
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function platformMeta(p: string): { label: string; icon: string; color: string } {
  switch (p) {
    case "shopify":
      return { label: "Shopify", icon: "\u{1F6CD}", color: "text-emerald-700 bg-emerald-50" };
    case "wix":
      return { label: "Wix", icon: "\u{1F310}", color: "text-blue-700 bg-blue-50" };
    case "square":
      return { label: "Square", icon: "\u{25A0}", color: "text-slate-700 bg-slate-100" };
    default:
      return { label: p, icon: "", color: "text-slate-600 bg-slate-50" };
  }
}

export default function UnmatchedPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<UnmatchedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [activePlatform, setActivePlatform] = useState<string | null>(null);

  const load = useCallback(
    async (platformFilter: string | null) => {
      try {
        const url = new URL("/api/skus/unmatched", window.location.origin);
        if (platformFilter) url.searchParams.set("platform", platformFilter);
        const res = await fetch(url.toString());
        if (!res.ok) {
          if (res.status === 401) {
            router.replace("/signin?callbackUrl=/skus/unmatched");
            return;
          }
          if (res.status === 403) {
            setForbidden(true);
            return;
          }
          const body = await res.json().catch(() => ({}));
          setError(body.error || `HTTP ${res.status}`);
          return;
        }
        const payload = (await res.json()) as UnmatchedResponse;
        setData(payload);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load unmatched items");
      }
    },
    [router]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load(activePlatform);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading) return;
    load(activePlatform);
  }, [activePlatform, load, loading]);

  // Stub action handler for commit 2 — actions ship in commit 3.
  const handleStubAction = useCallback(() => {
    setError("The bulk-match actions ship in the next commit. Sit tight!");
  }, []);

  // Detect Square POS Custom Amount items in the current page →
  // shows the explainer banner only when there are any to discuss.
  const hasSquareCustomAmount = useMemo(() => {
    if (!data) return false;
    return data.items.some(
      (it) => it.platform === "square" && it.externalItemId === null
    );
  }, [data]);

  // ── Render guards ────────────────────────────────────────────
  if (forbidden) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/skus"
            backLabel="SKUs"
            title="Unmatched items"
            subtitle="Pro feature"
          />
          <div className="bg-white rounded-xl border border-slate-200 py-12 px-6 text-center">
            <p className="text-base font-medium text-slate-700 m-0 mb-4">
              SKU catalog is part of FlowWork Pro.
            </p>
            <Link
              href="/upgrade"
              className="inline-block py-2 px-4 rounded-lg bg-blue-500 text-white text-sm font-semibold no-underline hover:bg-blue-600"
            >
              See Pro plans
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/skus"
          backLabel="SKUs"
          title="Unmatched items"
          subtitle="Every line item we couldn't auto-resolve to a FlowWork SKU. Mapping one here lights up COGS on every historical sale of that item — instantly."
        />

        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        )}

        {/* Anti-Crafty: Square Custom Amount info banner */}
        {hasSquareCustomAmount && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 mb-5">
            <p className="text-sm font-semibold m-0 mb-1">
              Square &ldquo;Custom Amount&rdquo; items are first-class here.
            </p>
            <p className="text-xs m-0 text-amber-800">
              When a POS register operator types a custom price instead of
              ringing up a catalog item, the sale lands with no item ID.
              Other tools force you to log a manual &ldquo;Manufacturing Run&rdquo;
              to deduct materials. We let you create a SKU from the item name
              right here — no recipe required.
            </p>
          </div>
        )}

        {/* Summary stat strip */}
        {data && (
          <div className="flex items-baseline gap-3 mb-5 flex-wrap">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {data.summary.totalGroups}
            </span>
            <span className="text-sm text-slate-500">
              unique unmatched item{data.summary.totalGroups === 1 ? "" : "s"}
              {" · "}
              {data.summary.totalLineItems} line item{data.summary.totalLineItems === 1 ? "" : "s"}
              {" · "}
              {fmtUsd(data.summary.totalRevenue)} of revenue currently uncategorized
            </span>
          </div>
        )}

        {/* Platform filter chips */}
        {data && data.summary.totalGroups > 0 && (
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500 mr-1">
              Filter:
            </span>
            <FilterChip
              label="All"
              count={data.summary.totalGroups}
              active={activePlatform === null}
              onClick={() => setActivePlatform(null)}
            />
            {(["shopify", "wix", "square"] as const).map((p) => {
              const meta = platformMeta(p);
              const count = data.summary.byPlatform[p]?.groupCount ?? 0;
              return (
                <FilterChip
                  key={p}
                  label={`${meta.icon} ${meta.label}`}
                  count={count}
                  active={activePlatform === p}
                  disabled={count === 0}
                  onClick={() => setActivePlatform(p)}
                />
              );
            })}
          </div>
        )}

        {/* Table or empty state */}
        {loading ? (
          <p className="text-center p-[60px] text-slate-500">
            Loading unmatched items…
          </p>
        ) : !data || data.items.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 py-12 px-6 text-center">
            <p className="text-5xl mb-3">{"\u{2728}"}</p>
            <p className="text-base font-medium text-slate-700 m-0 mb-1">
              All caught up
            </p>
            <p className="text-sm text-slate-500 m-0 mb-4 max-w-md mx-auto">
              {activePlatform
                ? `No unmatched ${platformMeta(activePlatform).label} items right now. Clear the filter to see other platforms.`
                : "Every line item across all your connected platforms is mapped to a FlowWork SKU. New sales will appear here if they bring in items we haven't seen before."}
            </p>
            <Link
              href="/skus"
              className="inline-block py-2 px-4 rounded-lg bg-blue-500 text-white text-sm font-semibold no-underline hover:bg-blue-600"
            >
              Back to SKU catalog
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th className="text-left py-2.5 px-4 font-medium">
                    Item name
                  </th>
                  <th className="text-left py-2.5 px-4 font-medium">Platform</th>
                  <th className="text-left py-2.5 px-4 font-medium">
                    Platform SKU / ID
                  </th>
                  <th className="text-right py-2.5 px-4 font-medium">Sales</th>
                  <th className="text-right py-2.5 px-4 font-medium">Revenue</th>
                  <th className="text-left py-2.5 px-4 font-medium">
                    Last sale
                  </th>
                  <th className="w-32 text-right py-2.5 px-4 font-medium">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => {
                  const meta = platformMeta(it.platform);
                  const isCustom = it.externalItemId === null;
                  return (
                    <tr
                      key={it.groupKey}
                      className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    >
                      <td className="py-3 px-4 text-slate-900 font-medium">
                        {it.name}
                        {isCustom && (
                          <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-semibold uppercase tracking-wide">
                            Custom amount
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}
                        >
                          <span>{meta.icon}</span>
                          <span>{meta.label}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-500 text-xs font-mono">
                        {it.externalSku ?? it.externalItemId ?? "—"}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-700 tabular-nums">
                        {it.lineItemCount}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-900 font-semibold tabular-nums whitespace-nowrap">
                        {fmtUsd(it.totalRevenue)}
                      </td>
                      <td className="py-3 px-4 text-slate-600 text-xs whitespace-nowrap">
                        {fmtDate(it.lastSoldAt)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={handleStubAction}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer bg-transparent border-0"
                        >
                          Map →
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-slate-400 text-center mt-6">
          Bulk-match UX (select N items → create or map in one shot) ships in
          the next commit.
        </p>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  disabled,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? "bg-slate-800 text-white border-slate-800 cursor-pointer"
          : disabled
            ? "bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed"
            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 cursor-pointer"
      }`}
    >
      <span>{label}</span>
      {count != null && count > 0 && (
        <span
          className={`tabular-nums text-[10px] px-1.5 py-0.5 rounded-full ${
            active ? "bg-white/20" : "bg-slate-100 text-slate-500"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
