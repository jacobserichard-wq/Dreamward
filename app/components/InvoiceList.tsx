// /invoices list surface: the outstanding-summary headline, the
// bucket-totals filter bar, and the invoice rows table.
//
// Pure-presentational. Page owns the data + filter state; this
// component just renders. Row click navigates to /invoices/[id].
//
// Send Reminder column on each row delegates to the parent's
// onSendReminder callback. Disabled-state logic (no email /
// cooldown / cap / terminal status) lives in reminderDisabledReason
// below — kept in sync with the server-side guards in
// app/api/invoices/[id]/reminder/route.ts.

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
  lastReminderSentAt: string | null;
  reminderCount: number;
  // Phase 6.5 commit 6 — source + review state from migration 0009.
  // source='email-auto' shows an "Auto" badge; needsReview=true swaps
  // the reminder button for Approve / Dismiss inline actions.
  source: "manual" | "email-auto";
  needsReview: boolean;
}

const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const REMINDER_CAP = 6;

export interface InvoiceListSummary {
  totalOutstanding: number;
  overdueOutstanding: number;
  bucketTotals: Record<AgingBucket, { count: number; amount: number }>;
  // Phase 6.5 commit 6 — drives the "Needs review (N)" filter chip
  // label. Counted across the full list (not the filtered view), so
  // toggling the chip doesn't change its own count.
  needsReviewCount: number;
}

interface InvoiceListProps {
  invoices: InvoiceListEntry[];
  summary: InvoiceListSummary;
  selectedBucket: AgingBucket | null;
  onSelectBucket: (b: AgingBucket | null) => void;
  // Phase 6.5 commit 6 — review filter is orthogonal to the bucket
  // filter; selecting either alone or both narrows the list. Page
  // owns the state.
  selectedNeedsReview: boolean;
  onToggleNeedsReview: () => void;
  /** Send-reminder click handler. Parent does the fetch + refresh. */
  onSendReminder: (invoiceId: number) => void;
  /** ID of the invoice whose reminder is currently being sent (for the
   *  in-flight spinner state). null when no send is in progress. */
  sendingReminderId: number | null;
  // Phase 6.5 commit 6 — review-queue actions. Parent handles the
  // PATCH /api/invoices/[id]/review fetch + list refresh.
  onApprove: (invoiceId: number) => void;
  onDismiss: (invoiceId: number) => void;
  reviewingId: number | null;
}

/**
 * Returns null when the Send Reminder button can be clicked; returns a
 * short user-visible reason string when the button must be disabled.
 * Same guard logic as the detail page Reminders section + the server
 * route — kept in sync so the UI never tries to send when the server
 * would reject.
 */
function reminderDisabledReason(inv: InvoiceListEntry): string | null {
  if (inv.status === "paid" || inv.status === "written_off") return "Settled";
  if (!inv.customerEmail) return "No email";
  if (inv.reminderCount >= REMINDER_CAP) return "At cap";
  if (inv.lastReminderSentAt) {
    const elapsed = Date.now() - new Date(inv.lastReminderSentAt).getTime();
    if (elapsed < REMINDER_COOLDOWN_MS) {
      const hoursLeft = Math.ceil(
        (REMINDER_COOLDOWN_MS - elapsed) / (60 * 60 * 1000)
      );
      return `${hoursLeft}h cooldown`;
    }
  }
  return null;
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
  selectedNeedsReview,
  onToggleNeedsReview,
  onSendReminder,
  sendingReminderId,
  onApprove,
  onDismiss,
  reviewingId,
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

      {/* Phase 6.5 commit 6: Needs review filter chip. Shown only when
          at least one row needs review — hidden completely for users
          who haven't run the Gmail ingest, so the surface doesn't
          confuse them. Orthogonal to the bucket chips (selecting both
          intersects the lists). */}
      {summary.needsReviewCount > 0 && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onToggleNeedsReview}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition border ${
              selectedNeedsReview
                ? "bg-amber-100 text-amber-900 border-amber-300"
                : "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
            }`}
          >
            <span>{"⚠️"}</span>
            Needs review ({summary.needsReviewCount})
            {selectedNeedsReview && <span className="text-xs">{"×"}</span>}
          </button>
          <span className="text-xs text-slate-500">
            Auto-detected from Gmail — approve or dismiss to clear the
            review queue.
          </span>
        </div>
      )}

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

      {(selectedBucket || selectedNeedsReview) && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-600">
            Filtered to{" "}
            <strong>
              {selectedBucket && selectedNeedsReview
                ? `${selectedBucket} + Needs review`
                : selectedBucket
                  ? selectedBucket
                  : "Needs review"}
            </strong>
          </span>
          <button
            type="button"
            onClick={() => {
              if (selectedBucket) onSelectBucket(null);
              if (selectedNeedsReview) onToggleNeedsReview();
            }}
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

      {/* Invoice rows. Two layouts:
          - Desktop (sm:block ↑): the 7-column table.
          - Mobile (<sm): stacked cards per design §8.
          Same data, different layout. Same row-level reminder button
          logic (reminderDisabledReason / sendingReminderId) reused. */}
      {invoices.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
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
                  <th className="text-right font-medium text-slate-600 py-2.5 px-3">
                    {/* Send reminder column */}
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
                        <div className="font-medium text-slate-900 flex items-center gap-1.5 flex-wrap">
                          <span>{inv.customerName}</span>
                          {/* Phase 6.5 commit 6: Auto badge for
                              email-detected rows. Distinct visual signal
                              vs. manual rows — important because the
                              extraction is fallible. */}
                          {inv.source === "email-auto" && (
                            <span
                              title="Auto-detected from a Gmail email"
                              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200"
                            >
                              Auto
                            </span>
                          )}
                          {inv.needsReview && (
                            <span
                              title="Awaiting your approval"
                              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-300"
                            >
                              Review
                            </span>
                          )}
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
                      <td
                        className="py-2.5 px-3 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Phase 6.5 commit 6: when a row needs review,
                            replace the reminder button with Approve /
                            Dismiss inline actions. Sending a reminder
                            on an unreviewed auto-detected row would be
                            embarrassing if the extraction was wrong —
                            force the user through the review step. */}
                        {inv.needsReview ? (
                          <div className="flex gap-1.5 justify-end">
                            <button
                              type="button"
                              onClick={() => onApprove(inv.id)}
                              disabled={reviewingId === inv.id}
                              title="Approve — clears the review flag and lets reminders go out"
                              className="text-xs py-1 px-2 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                            >
                              {reviewingId === inv.id ? "..." : "Approve"}
                            </button>
                            <button
                              type="button"
                              onClick={() => onDismiss(inv.id)}
                              disabled={reviewingId === inv.id}
                              title="Dismiss — hard-deletes this row. Re-fetch from Gmail to recover."
                              className="text-xs py-1 px-2 rounded border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                            >
                              {reviewingId === inv.id ? "..." : "Dismiss"}
                            </button>
                          </div>
                        ) : (
                          (() => {
                            const reason = reminderDisabledReason(inv);
                            const isSending = sendingReminderId === inv.id;
                            const disabled = reason !== null || isSending;
                            return (
                              <button
                                type="button"
                                onClick={() => onSendReminder(inv.id)}
                                disabled={disabled}
                                title={
                                  reason
                                    ? `Can't send: ${reason}`
                                    : `Send reminder to ${inv.customerEmail}`
                                }
                                className="text-xs py-1 px-2 rounded border border-slate-300 bg-white text-slate-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                              >
                                {isSending ? "Sending..." : `${"\u{1F4E9}"} Remind`}
                              </button>
                            );
                          })()
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <div className="sm:hidden divide-y divide-slate-100">
            {invoices.map((inv) => {
              const days = daysOverdue(inv.dueDate);
              const reason = reminderDisabledReason(inv);
              const isSending = sendingReminderId === inv.id;
              const reminderDisabled = reason !== null || isSending;
              return (
                <div
                  key={inv.id}
                  onClick={() => router.push(`/invoices/${inv.id}`)}
                  className="p-4 cursor-pointer hover:bg-slate-50"
                >
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-900 truncate flex items-center gap-1.5 flex-wrap">
                        <span className="truncate">{inv.customerName}</span>
                        {inv.source === "email-auto" && (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                            Auto
                          </span>
                        )}
                        {inv.needsReview && (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-300">
                            Review
                          </span>
                        )}
                      </div>
                      {inv.customerEmail && (
                        <div className="text-xs text-slate-500 truncate">
                          {inv.customerEmail}
                        </div>
                      )}
                    </div>
                    <AgingBucketChip bucket={inv.agingBucket} compact />
                  </div>

                  <div className="flex justify-between items-baseline gap-2 mb-2">
                    <div className="font-semibold text-slate-900">
                      {formatUsd(inv.amountOutstanding)}
                      {inv.amountPaid > 0 && (
                        <span className="text-xs text-slate-500 font-normal ml-1">
                          of {formatUsd(inv.amountTotal)}
                        </span>
                      )}
                    </div>
                    {inv.invoiceNumber && (
                      <div className="text-xs text-slate-500">
                        #{inv.invoiceNumber}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center gap-2">
                    <div className="text-xs text-slate-500">
                      Due {inv.dueDate}
                      {days > 0 && (
                        <span className="text-red-700 font-medium ml-1">
                          (+{days}d)
                        </span>
                      )}
                    </div>
                    {inv.needsReview ? (
                      <div
                        className="flex gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => onApprove(inv.id)}
                          disabled={reviewingId === inv.id}
                          className="text-xs py-1 px-2 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 disabled:opacity-40 cursor-pointer"
                        >
                          {reviewingId === inv.id ? "..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDismiss(inv.id)}
                          disabled={reviewingId === inv.id}
                          className="text-xs py-1 px-2 rounded border border-red-300 bg-red-50 text-red-700 disabled:opacity-40 cursor-pointer"
                        >
                          {reviewingId === inv.id ? "..." : "Dismiss"}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSendReminder(inv.id);
                        }}
                        disabled={reminderDisabled}
                        title={
                          reason
                            ? `Can't send: ${reason}`
                            : `Send reminder to ${inv.customerEmail}`
                        }
                        className="text-xs py-1 px-2 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {isSending ? "Sending..." : `${"\u{1F4E9}"} Remind`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
