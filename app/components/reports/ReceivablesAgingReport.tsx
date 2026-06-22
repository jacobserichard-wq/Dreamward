// app/components/reports/ReceivablesAgingReport.tsx
//
// "Receivables aging" business report. Current outstanding invoices by
// age bucket and by customer — "who owes me, and who to chase". This is
// an as-of-today snapshot (aging is relative to now), so the period +
// channel filters don't apply (the hub renders it without them).
// Sourced from /api/invoices (already computes amountOutstanding +
// agingBucket).

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ReportExportButtons from "./ReportExportButtons";
import ReportHelp from "./ReportHelp";
import type { ReportExportSpec } from "./reportExport";

interface Invoice {
  id: number;
  customerName: string | null;
  invoiceNumber: string | null;
  amountOutstanding: number;
  status: string;
  agingBucket: string;
}
interface InvoicesResp {
  invoices: Invoice[];
  summary: {
    totalOutstanding: number;
    overdueOutstanding: number;
    bucketTotals: Record<string, { count: number; amount: number }>;
    bucketOrder: string[];
  };
}

// Buckets that represent money still owed (exclude settled states).
const OUTSTANDING_BUCKETS = [
  "Current",
  "1–30 days",
  "31–60 days",
  "61–90 days",
  "91+ days",
];

function fmtUsd(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-$${abs}` : `$${abs}`;
}
function bucketTone(bucket: string): string {
  if (bucket === "91+ days") return "text-red-700";
  if (bucket === "61–90 days" || bucket === "31–60 days")
    return "text-amber-700";
  return "text-slate-600";
}

export default function ReceivablesAgingReport() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InvoicesResp | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/invoices");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as InvoicesResp;
        if (!cancelled) setData(d);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Couldn't load AR");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <p className="text-center py-12 text-slate-500 text-sm">
        Loading receivables…
      </p>
    );
  }
  if (error) return <p className="text-sm text-red-700 py-4">{error}</p>;
  if (!data) return null;

  const buckets = OUTSTANDING_BUCKETS.map((b) => ({
    bucket: b,
    count: data.summary.bucketTotals[b]?.count ?? 0,
    amount: data.summary.bucketTotals[b]?.amount ?? 0,
  })).filter((b) => b.count > 0 || b.amount > 0);

  // By customer: outstanding only, grouped, worst bucket tracked.
  const sev = (b: string) => OUTSTANDING_BUCKETS.indexOf(b);
  const byCustomer = new Map<
    string,
    { name: string; amount: number; worst: string; count: number }
  >();
  for (const inv of data.invoices) {
    if (inv.amountOutstanding <= 0) continue;
    if (inv.status === "paid" || inv.status === "written_off") continue;
    const name = inv.customerName?.trim() || "—";
    const ex = byCustomer.get(name);
    if (ex) {
      ex.amount += inv.amountOutstanding;
      ex.count += 1;
      if (sev(inv.agingBucket) > sev(ex.worst)) ex.worst = inv.agingBucket;
    } else {
      byCustomer.set(name, {
        name,
        amount: inv.amountOutstanding,
        worst: inv.agingBucket,
        count: 1,
      });
    }
  }
  const customers = Array.from(byCustomer.values()).sort(
    (a, b) => b.amount - a.amount
  );

  const buildSpec = (): ReportExportSpec => ({
    filename: "receivables-aging",
    title: "Receivables aging",
    meta: [
      "As of today",
      `Total outstanding: ${fmtUsd(data.summary.totalOutstanding)}`,
      `Overdue: ${fmtUsd(data.summary.overdueOutstanding)}`,
    ],
    tables: [
      {
        heading: "By age",
        columns: ["Age", "Invoices", "Outstanding"],
        rows: buckets.map((b) => [b.bucket, b.count, fmtUsd(b.amount)]),
      },
      {
        heading: "By customer",
        columns: ["Customer", "Invoices", "Oldest", "Outstanding"],
        rows: customers.map((c) => [
          c.name,
          c.count,
          c.worst,
          fmtUsd(c.amount),
        ]),
      },
    ],
  });

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-xl font-bold text-slate-900 m-0">
              Receivables aging
            </h2>
            <ReportHelp reportId="ar" />
          </div>
          <p className="text-xs text-slate-500 m-0">
            As of today · who owes you
          </p>
        </div>
        <ReportExportButtons
          buildSpec={buildSpec}
          disabled={data.summary.totalOutstanding === 0}
        />
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 mt-4 max-w-md">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 m-0 mb-1">
            Total outstanding
          </p>
          <p className="text-2xl font-bold text-slate-900 m-0 tabular-nums">
            {fmtUsd(data.summary.totalOutstanding)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 m-0 mb-1">
            Overdue
          </p>
          <p
            className={`text-2xl font-bold m-0 tabular-nums ${
              data.summary.overdueOutstanding > 0
                ? "text-red-700"
                : "text-slate-900"
            }`}
          >
            {fmtUsd(data.summary.overdueOutstanding)}
          </p>
        </div>
      </div>

      {/* By age */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
        <h3 className="text-sm font-semibold text-slate-700 m-0 mb-3 uppercase tracking-wide">
          By age
        </h3>
        {buckets.length === 0 ? (
          <p className="text-center py-6 text-slate-400 text-sm">
            Nothing outstanding — you&rsquo;re all paid up. 🎉
          </p>
        ) : (
          <ul className="m-0 p-0 list-none">
            {buckets.map((b) => (
              <li
                key={b.bucket}
                className="flex items-center justify-between gap-3 px-1 py-2 border-t border-slate-100"
              >
                <span className={`text-sm font-medium ${bucketTone(b.bucket)}`}>
                  {b.bucket}
                </span>
                <span className="flex items-baseline gap-3">
                  <span className="text-xs text-slate-400">
                    {b.count} invoice{b.count === 1 ? "" : "s"}
                  </span>
                  <span className="text-sm tabular-nums font-semibold text-slate-900 w-24 text-right">
                    {fmtUsd(b.amount)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* By customer */}
      {customers.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
          <h3 className="text-sm font-semibold text-slate-700 m-0 mb-3 uppercase tracking-wide">
            By customer
          </h3>
          <div className="flex items-center gap-3 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            <span className="flex-1">Customer</span>
            <span className="w-24">Oldest</span>
            <span className="w-28 text-right">Outstanding</span>
          </div>
          <ul className="m-0 p-0 list-none">
            {customers.map((c) => (
              <li
                key={c.name}
                className="flex items-center gap-3 px-1 py-2.5 border-t border-slate-100"
              >
                <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">
                  {c.name}
                  <span className="text-[11px] text-slate-400 ml-1.5">
                    {c.count} inv
                  </span>
                </span>
                <span className={`w-24 text-xs font-medium ${bucketTone(c.worst)}`}>
                  {c.worst}
                </span>
                <span className="w-28 text-right text-sm tabular-nums font-semibold text-slate-900">
                  {fmtUsd(c.amount)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-slate-400 m-0 mt-3">
            Chase the top of this list first.{" "}
            <Link href="/invoices" className="text-blue-600 hover:underline">
              Open AR →
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
