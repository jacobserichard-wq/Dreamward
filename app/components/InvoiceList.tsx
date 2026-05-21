// /invoices list surface: the outstanding-summary headline, the
// bucket-totals filter bar, and the invoice rows table.
//
// Pure-presentational. Page owns the data + filter state; this
// component just renders. Row click navigates to /invoices/[id].
//
// Send-reminder action is NOT in this commit — commit 8 (email
// template + reminder send route) adds the button column and wires
// the POST /api/invoices/[id]/reminder call.

import { useRouter } from "next/navigation";
import Link from "next/link";
import AgingBucketChip from "./AgingBucketChip";
import { AGING_BUCKETS_ORDERED, type AgingBucket } from "@/lib/aging";

export interface InvoiceListEntry {
  id: number;
  customerName: string;
  customerEmail: string | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  amountTotal: number;
  amountPaid: number;
  amountOutstanding: number;
  status: "open" | "partial" | "paid" | "written_off";
  agingBucket: AgingBucket;
}

export interface InvoiceListSummary {
  totalOutstanding: number;
  overdueOutstanding: number;
  bucketTotals: Record<AgingBucket, { count: number; amount: number }>;
}

interface InvoiceListProps {
  invoices: InvoiceListEntry[];
  summary: InvoiceListSummary;
  selectedBucket: AgingBucket | null;
  onSelectBucket: (b: AgingBucket | null) => void;
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function daysOverdue(dueDate: string, today: Date = new Date()): number {
  const due = new Date(`${dueDate}T00:00:00Z`).getTime();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  return Math.floor((todayUtc - due) / 86400000);
}

export default function InvoiceList({
  invoices,
  summary,
  selectedBucket,
  onSelectBucket,
}: InvoiceListProps) {
  const router = useRouter();
  const overdueShare =
    summary.totalOutstanding > 0
      ? summary.overdueOutstanding / summary.totalOutstanding
      : 0;
  const headlineTone =
    overdueShare >= 0.5
      ? "text-red-700"
      : summary.overdueOutstanding > 0
        ? "text-amber-700"
        : "text-slate-700";

  return (
    <div>
      {/* Outstanding summary headline */}
      <div className="mb-5">
        <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-1">
          Outstanding
        </h2>
        <p className={`text-3xl font-bold m-0 ${headlineTone}`}>
          {formatUsd(summary.totalOutstanding)}
        </p>
        {summary.overdueOutstanding > 0 && (
          <p className="text-sm text-slate-600 mt-1 m-0">
            {formatUsd(summary.overdueOutstanding)} overdue
          </p>
        )}
      </div>

      {/* Bucket totals — clickable filter chips */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mb-5">
        {AGING_BUCKETS_ORDERED.map((bucket) => {
          const totals = summary.bucketTotals[bucket];
          const isSelected = selectedBucket === bucket;
          return (
            <AgingBucketChip
              key={bucket}
              bucket={bucket}
              count={totals.count}
              amount={totals.amount}
              selected={isSelected}
              onClick={() => onSelectBucket(isSelected ? null : bucket)}
            />
          );
        })}
      </div>

      {selectedBucket && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm text-slate-600">
            Filtered to <strong>{selectedBucket}</strong>
          </span>
          <button
            type="button"
            onClick={() => onSelectBucket(null)}
            className="text-sm text-blue-600 hover:underline cursor-pointer"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Empty state */}
      {invoices.length === 0 && !selectedBucket && (
        <div className="bg-white border border-slate-200 rounded-xl py-12 px-6 text-center">
          <p className="text-base font-medium text-slate-700 m-0 mb-2">
            No invoices yet
          </p>
          <p className="text-sm text-slate-500 m-0 mb-5">
            Track wholesale and consignment invoices, and chase overdue
            payments in one place.
          </p>
          <Link
            href="/invoices/new"
            className="inline-block py-2.5 px-6 rounded-lg bg-blue-500 text-white text-sm font-semibold no-underline cursor-pointer"
          >
            Create your first invoice
          </Link>
        </div>
      )}

      {/* Empty state — filter active, no matches */}
      {invoices.length === 0 && selectedBucket && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl py-8 px-6 text-center">
          <p className="text-sm text-slate-600 m-0">
            No invoices in the <strong>{selectedBucket}</strong> bucket.
          </p>
        </div>
      )}

      {/* Invoice rows */}
      {invoices.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium text-slate-600 py-2.5 px-3">
                    Customer
                  </th>
                  <th className="text-left font-medium text-slate-600 py-2.5 px-3">
                    Invoice #
                  </th>
                  <th className="text-right font-medium text-slate-600 py-2.5 px-3">
                    Outstanding
                  </th>
                  <th className="text-left font-medium text-slate-600 py-2.5 px-3">
                    Due
                  </th>
                  <th className="text-right font-medium text-slate-600 py-2.5 px-3">
                    Days
                  </th>
                  <th className="text-left font-medium text-slate-600 py-2.5 px-3">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const days = daysOverdue(inv.dueDate);
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => router.push(`/invoices/${inv.id}`)}
                      className="border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-slate-50"
                    >
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-900">
                          {inv.customerName}
                        </div>
                        {inv.customerEmail && (
                          <div className="text-xs text-slate-500">
                            {inv.customerEmail}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">
                        {inv.invoiceNumber || (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-slate-900">
                        {formatUsd(inv.amountOutstanding)}
                        {inv.amountPaid > 0 && (
                          <div className="text-xs text-slate-500 font-normal">
                            of {formatUsd(inv.amountTotal)}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">
                        {inv.dueDate}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {days > 0 ? (
                          <span className="text-red-700 font-medium">
                            +{days}
                          </span>
                        ) : days < 0 ? (
                          <span className="text-slate-500">{days}</span>
                        ) : (
                          <span className="text-slate-500">0</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <AgingBucketChip bucket={inv.agingBucket} compact />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
