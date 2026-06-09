"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "../../components/PageHeader";
import AppHeader from "../../components/AppHeader";
import ErrorBanner from "../../components/ErrorBanner";
import AgingBucketChip from "../../components/AgingBucketChip";
import PaymentHistoryTable from "../../components/PaymentHistoryTable";
import PaymentRecordForm, {
  type PaymentSubmitPayload,
} from "../../components/PaymentRecordForm";
import type { AgingBucket } from "@/lib/aging";

// Phase 6 invoice detail page. Mirror of /events/[id] in shape:
//   - Top: invoice metadata (read-only with [Edit] toggle to inline form)
//   - Middle: payments history table + record-payment form
//   - Reminders: last-sent + count + Send button (24h cooldown, 6 cap)
//   - Bottom: danger zone (Mark as written off, Delete invoice)
//
// The Reminders section calls POST /api/invoices/[id]/reminder which
// sends via Resend with Reply-To = the user's session email.

interface InvoiceDetail {
  id: number;
  clientId: number;
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
  isOverdue: boolean;
  notes: string | null;
  lastReminderSentAt: string | null;
  reminderCount: number;
  createdAt: string;
  updatedAt: string;
}

interface PaymentDetail {
  id: number;
  invoiceId: number;
  amount: number;
  paidAt: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  createdAt: string;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const REMINDER_CAP = 6;

export default function InvoiceDetailPage({ params }: PageProps) {
  const { id: rawId } = use(params);
  const router = useRouter();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [payments, setPayments] = useState<PaymentDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Edit-mode toggle for the metadata block.
  const [isEditing, setIsEditing] = useState(false);
  const [editCustomerName, setEditCustomerName] = useState("");
  const [editCustomerEmail, setEditCustomerEmail] = useState("");
  const [editInvoiceNumber, setEditInvoiceNumber] = useState("");
  const [editInvoiceDate, setEditInvoiceDate] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editAmountTotal, setEditAmountTotal] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Async action state.
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<number | null>(
    null
  );
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reminderSending, setReminderSending] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/invoices/${rawId}`);
    if (res.status === 401) {
      router.replace(`/signin?callbackUrl=/invoices/${rawId}`);
      return;
    }
    if (res.status === 403) {
      setError("AR is a Growth-and-Pro feature. Upgrade to access invoices.");
      return;
    }
    if (res.status === 404) {
      setError("Invoice not found.");
      return;
    }
    if (!res.ok) {
      setError(`Couldn't load invoice: HTTP ${res.status}`);
      return;
    }
    const data: { invoice: InvoiceDetail; payments: PaymentDetail[] } =
      await res.json();
    setInvoice(data.invoice);
    setPayments(data.payments || []);
    // Seed edit form from the loaded invoice.
    setEditCustomerName(data.invoice.customerName);
    setEditCustomerEmail(data.invoice.customerEmail || "");
    setEditInvoiceNumber(data.invoice.invoiceNumber || "");
    setEditInvoiceDate(data.invoice.invoiceDate);
    setEditDueDate(data.invoice.dueDate);
    setEditAmountTotal(String(data.invoice.amountTotal));
    setEditNotes(data.invoice.notes || "");
  }, [rawId, router]);

  useEffect(() => {
    async function init() {
      try {
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load page");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [load]);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEdit(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${rawId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: editCustomerName,
          customerEmail: editCustomerEmail || null,
          invoiceNumber: editInvoiceNumber || null,
          invoiceDate: editInvoiceDate,
          dueDate: editDueDate,
          amountTotal: Number(editAmountTotal.replace(/[$,\s]/g, "")),
          notes: editNotes || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setIsEditing(false);
      setSuccessMsg("Invoice updated.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update invoice");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRecordPayment = async (p: PaymentSubmitPayload) => {
    setPaymentSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${rawId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSuccessMsg(`Recorded ${formatUsd(p.amount)} payment.`);
      await load();
    } finally {
      setPaymentSaving(false);
    }
  };

  const handleDeletePayment = async (paymentId: number) => {
    const ok = confirm(
      "Remove this payment? The invoice balance will be adjusted."
    );
    if (!ok) return;
    setDeletingPaymentId(paymentId);
    setError(null);
    try {
      const res = await fetch(
        `/api/invoices/${rawId}/payments/${paymentId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSuccessMsg("Payment removed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove payment");
    } finally {
      setDeletingPaymentId(null);
    }
  };

  const handleWriteOff = async () => {
    if (!invoice) return;
    const ok = confirm(
      `Mark invoice as written off? The outstanding ${formatUsd(invoice.amountOutstanding)} will be treated as uncollectable.`
    );
    if (!ok) return;
    setStatusUpdating(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${rawId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "written_off" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSuccessMsg("Invoice marked as written off.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleSendReminder = async () => {
    if (!invoice) return;
    setReminderSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${rawId}/reminder`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSuccessMsg(`Reminder sent to ${invoice.customerEmail}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reminder");
    } finally {
      setReminderSending(false);
    }
  };

  const handleDelete = async () => {
    if (!invoice) return;
    const ok = confirm(
      `Delete invoice for ${invoice.customerName}? This is permanent and removes all recorded payments.`
    );
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${rawId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      router.push("/invoices");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete invoice");
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <AppHeader />
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">
            Loading invoice...
          </p>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <AppHeader />
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/invoices"
            backLabel="Invoices"
            title="Invoice"
          />
          {error && (
            <ErrorBanner message={error} onDismiss={() => setError(null)} />
          )}
        </div>
      </div>
    );
  }

  const isTerminal =
    invoice.status === "paid" || invoice.status === "written_off";

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/invoices"
          backLabel="Invoices"
          title={
            <>
              {invoice.customerName}
              {invoice.invoiceNumber && (
                <span className="text-slate-500 font-normal">
                  {" "}— Invoice #{invoice.invoiceNumber}
                </span>
              )}
            </>
          }
          rightSlot={<AgingBucketChip bucket={invoice.agingBucket} compact />}
        />

        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        )}
        {successMsg && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-4 py-2 mb-4 flex justify-between items-center">
            <span>{successMsg}</span>
            <button
              type="button"
              onClick={() => setSuccessMsg(null)}
              className="text-emerald-600 hover:underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Invoice details */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-slate-900 m-0">
              Invoice details
            </h2>
            {!isEditing && (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="text-sm text-blue-600 hover:underline cursor-pointer"
              >
                Edit
              </button>
            )}
          </div>

          {!isEditing ? (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-slate-500 text-xs uppercase tracking-wide">
                  Customer
                </dt>
                <dd className="text-slate-900 m-0">{invoice.customerName}</dd>
              </div>
              <div>
                <dt className="text-slate-500 text-xs uppercase tracking-wide">
                  Email
                </dt>
                <dd className="text-slate-900 m-0">
                  {invoice.customerEmail || (
                    <span className="text-slate-400">—</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 text-xs uppercase tracking-wide">
                  Invoice date
                </dt>
                <dd className="text-slate-900 m-0">{invoice.invoiceDate}</dd>
              </div>
              <div>
                <dt className="text-slate-500 text-xs uppercase tracking-wide">
                  Due date
                </dt>
                <dd className="text-slate-900 m-0">{invoice.dueDate}</dd>
              </div>
              <div>
                <dt className="text-slate-500 text-xs uppercase tracking-wide">
                  Amount total
                </dt>
                <dd className="text-slate-900 m-0">
                  {formatUsd(invoice.amountTotal)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 text-xs uppercase tracking-wide">
                  Amount paid
                </dt>
                <dd className="text-slate-900 m-0">
                  {formatUsd(invoice.amountPaid)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 text-xs uppercase tracking-wide">
                  Outstanding
                </dt>
                <dd className="text-slate-900 m-0 font-semibold">
                  {formatUsd(invoice.amountOutstanding)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 text-xs uppercase tracking-wide">
                  Status
                </dt>
                <dd className="text-slate-900 m-0">
                  <span className="capitalize">{invoice.status}</span>
                </dd>
              </div>
              {invoice.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-slate-500 text-xs uppercase tracking-wide">
                    Notes
                  </dt>
                  <dd className="text-slate-700 m-0">{invoice.notes}</dd>
                </div>
              )}
            </dl>
          ) : (
            <form onSubmit={handleSaveEdit}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <label className="block sm:col-span-2">
                  <span className="block text-xs font-medium text-slate-600 mb-1">
                    Customer name *
                  </span>
                  <input
                    type="text"
                    value={editCustomerName}
                    onChange={(e) => setEditCustomerName(e.target.value)}
                    required
                    disabled={savingEdit}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">
                    Customer email
                  </span>
                  <input
                    type="email"
                    value={editCustomerEmail}
                    onChange={(e) => setEditCustomerEmail(e.target.value)}
                    disabled={savingEdit}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">
                    Invoice number
                  </span>
                  <input
                    type="text"
                    value={editInvoiceNumber}
                    onChange={(e) => setEditInvoiceNumber(e.target.value)}
                    disabled={savingEdit}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">
                    Invoice date *
                  </span>
                  <input
                    type="date"
                    value={editInvoiceDate}
                    onChange={(e) => setEditInvoiceDate(e.target.value)}
                    required
                    disabled={savingEdit}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">
                    Due date *
                  </span>
                  <input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    required
                    disabled={savingEdit}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="block text-xs font-medium text-slate-600 mb-1">
                    Amount total *
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={editAmountTotal}
                    onChange={(e) => setEditAmountTotal(e.target.value)}
                    required
                    disabled={savingEdit}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="block text-xs font-medium text-slate-600 mb-1">
                    Notes
                  </span>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    disabled={savingEdit}
                    rows={2}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500"
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    // Reset form fields back to invoice values.
                    setEditCustomerName(invoice.customerName);
                    setEditCustomerEmail(invoice.customerEmail || "");
                    setEditInvoiceNumber(invoice.invoiceNumber || "");
                    setEditInvoiceDate(invoice.invoiceDate);
                    setEditDueDate(invoice.dueDate);
                    setEditAmountTotal(String(invoice.amountTotal));
                    setEditNotes(invoice.notes || "");
                  }}
                  disabled={savingEdit}
                  className="py-2 px-4 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="py-2 px-5 rounded-lg border-0 bg-blue-500 text-white text-sm font-semibold cursor-pointer disabled:opacity-60"
                >
                  {savingEdit ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          )}
        </section>

        {/* Payments */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <h2 className="text-lg font-semibold text-slate-900 m-0 mb-4">
            Payments
          </h2>
          <PaymentHistoryTable
            payments={payments}
            onDelete={handleDeletePayment}
            deletingPaymentId={deletingPaymentId}
          />
          {!isTerminal && invoice.amountOutstanding > 0 && (
            <PaymentRecordForm
              outstanding={invoice.amountOutstanding}
              onSubmit={handleRecordPayment}
              saving={paymentSaving}
            />
          )}
        </section>

        {/* Reminders — only meaningful for non-terminal invoices */}
        {!isTerminal &&
          (() => {
            const noEmail = !invoice.customerEmail;
            const lastSentMs = invoice.lastReminderSentAt
              ? new Date(invoice.lastReminderSentAt).getTime()
              : null;
            const msSinceLast =
              lastSentMs !== null ? Date.now() - lastSentMs : null;
            const inCooldown =
              msSinceLast !== null && msSinceLast < REMINDER_COOLDOWN_MS;
            const hoursLeft = inCooldown
              ? Math.ceil(
                  (REMINDER_COOLDOWN_MS - (msSinceLast ?? 0)) /
                    (60 * 60 * 1000)
                )
              : 0;
            const atCap = invoice.reminderCount >= REMINDER_CAP;
            const disabled =
              noEmail || inCooldown || atCap || reminderSending;
            const disabledReason = noEmail
              ? "Add a customer email first"
              : inCooldown
                ? `Wait ${hoursLeft}h before re-sending`
                : atCap
                  ? `This invoice has hit the ${REMINDER_CAP}-reminder cap`
                  : null;
            return (
              <section className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
                <h2 className="text-lg font-semibold text-slate-900 m-0 mb-4">
                  Reminders
                </h2>
                <div className="text-sm text-slate-600 mb-4 space-y-1">
                  <p className="m-0">
                    Last sent:{" "}
                    {invoice.lastReminderSentAt ? (
                      <span className="text-slate-900">
                        {timeAgo(invoice.lastReminderSentAt)}
                      </span>
                    ) : (
                      <span className="text-slate-400">never</span>
                    )}
                  </p>
                  <p className="m-0">
                    Total sent:{" "}
                    <span className="text-slate-900">
                      {invoice.reminderCount}
                    </span>{" "}
                    of {REMINDER_CAP}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={handleSendReminder}
                    disabled={disabled}
                    title={disabledReason ?? undefined}
                    className="py-2 px-5 rounded-lg border-0 bg-blue-500 text-white text-sm font-semibold cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed"
                  >
                    {reminderSending
                      ? "Sending..."
                      : `${"\u{1F4E9}"} Send reminder now`}
                  </button>
                  {disabledReason && (
                    <span className="text-sm text-slate-500">
                      {disabledReason}
                    </span>
                  )}
                </div>
                {!disabledReason && invoice.customerEmail && (
                  <p className="text-xs text-slate-500 mt-2 m-0">
                    Will email{" "}
                    <span className="text-slate-700">
                      {invoice.customerEmail}
                    </span>
                    . Replies route back to you.
                  </p>
                )}
              </section>
            );
          })()}

        {/* Danger zone */}
        <section className="border border-red-200 rounded-xl p-5 bg-red-50/40">
          <h2 className="text-base font-semibold text-red-800 m-0 mb-3">
            Danger zone
          </h2>
          <div className="flex flex-wrap gap-3">
            {invoice.status !== "written_off" &&
              invoice.status !== "paid" && (
                <button
                  type="button"
                  onClick={handleWriteOff}
                  disabled={statusUpdating}
                  className="py-2 px-4 rounded-lg border border-amber-300 bg-white text-amber-800 text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {statusUpdating ? "Updating..." : "Mark as written off"}
                </button>
              )}
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="py-2 px-4 rounded-lg border border-red-300 bg-white text-red-800 text-sm font-medium cursor-pointer disabled:opacity-60"
            >
              {deleting ? "Deleting..." : "Delete invoice"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
