"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "../components/PageHeader";
import AppHeader from "../components/AppHeader";
import ErrorBanner from "../components/ErrorBanner";
import SectionTip from "../components/SectionTip";
import InvoiceList, {
  type InvoiceListEntry,
  type InvoiceListSummary,
} from "../components/InvoiceList";
import FetchFromGmailModal from "../components/FetchFromGmailModal";
import { FEATURES } from "@/lib/features";
import { isPayingTier } from "@/lib/plans";
import type { AgingBucket } from "@/lib/aging";

// Phase 6 list surface. Mirrors the events-page pattern (commit-3 era
// of Phase 3): client-side fetch, plan-gating with a starter upgrade
// prompt, errors via ErrorBanner.

interface ListResponse {
  invoices: InvoiceListEntry[];
  summary: InvoiceListSummary;
}

export default function InvoicesPage() {
  const router = useRouter();
  const [plan, setPlan] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceListEntry[]>([]);
  const [summary, setSummary] = useState<InvoiceListSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<AgingBucket | null>(null);
  const [sendingReminderId, setSendingReminderId] = useState<number | null>(
    null
  );
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // Phase 6.5 commit 6: review-queue filter state + per-row "in-flight"
  // id while a PATCH /api/invoices/[id]/review is on the wire.
  const [selectedNeedsReview, setSelectedNeedsReview] = useState(false);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  // Phase 6.5 commit 7: Fetch-from-Gmail modal open state.
  const [fetchModalOpen, setFetchModalOpen] = useState(false);

  const loadInvoices = useCallback(async () => {
    const res = await fetch("/api/invoices");
    if (res.status === 401) {
      router.replace("/signin?callbackUrl=/invoices");
      return;
    }
    if (res.status === 403) {
      setInvoices([]);
      setSummary(null);
      return;
    }
    if (!res.ok) {
      setError(`Couldn't load invoices: HTTP ${res.status}`);
      return;
    }
    const data: ListResponse = await res.json();
    setInvoices(data.invoices || []);
    setSummary(data.summary || null);
  }, [router]);

  useEffect(() => {
    async function load() {
      try {
        const clientRes = await fetch("/api/client");
        if (clientRes.status === 401) {
          router.replace("/signin?callbackUrl=/invoices");
          return;
        }
        if (!clientRes.ok) {
          setError(`Couldn't load account: HTTP ${clientRes.status}`);
          return;
        }
        const clientData = await clientRes.json();
        setPlan(clientData.plan);

        // Starter sees the upgrade prompt, not the list (mirrors events).
        if (!isPayingTier(clientData.plan)) return;

        await loadInvoices();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load page");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router, loadInvoices]);

  // Phase 6.5 commit 6: approve/dismiss handlers. Optimistic UI would
  // be nicer but the count chip needs the server-truth needsReviewCount
  // to update — reload list is the simpler path.
  const handleApprove = async (invoiceId: number) => {
    setReviewingId(invoiceId);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSuccessMsg("Invoice approved.");
      await loadInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setReviewingId(null);
    }
  };

  const handleDismiss = async (invoiceId: number) => {
    // Confirm because this is a hard delete. No undo (re-fetch from
    // Gmail is the recovery path — see lib/invoices.dismissInvoice).
    if (
      !window.confirm(
        "Dismiss this auto-detected invoice? It will be deleted. You can re-fetch from Gmail to recover it."
      )
    ) {
      return;
    }
    setReviewingId(invoiceId);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSuccessMsg("Invoice dismissed.");
      await loadInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dismiss failed");
    } finally {
      setReviewingId(null);
    }
  };

  const handleSendReminder = async (invoiceId: number) => {
    setSendingReminderId(invoiceId);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/reminder`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSuccessMsg("Reminder sent.");
      await loadInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reminder");
    } finally {
      setSendingReminderId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">
            Loading invoices...
          </p>
        </div>
      </div>
    );
  }

  if (!isPayingTier(plan)) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/dashboard"
            backLabel="FlowWork"
            title="Invoices"
            subtitle="Track wholesale invoices and chase overdue payments"
          />
          <div className="bg-amber-50 border border-amber-200 rounded-xl py-8 px-6 text-center">
            <p className="text-base font-medium text-amber-900 m-0 mb-2">
              {"\u{1F512}"} Active subscription required
            </p>
            <p className="text-sm text-amber-800 m-0 mb-5 leading-relaxed">
              Start your subscription — from $10/mo — to track wholesale and
              consignment invoices, see aging buckets at a glance, and send
              polite follow-ups in one tap. AR is included on every tier.
            </p>
            <Link
              href="/billing"
              className="inline-block py-2.5 px-6 rounded-lg bg-amber-600 text-white text-sm font-semibold no-underline cursor-pointer"
            >
              View plans
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Apply the bucket + needs-review filters client-side. Summary stays
  // computed over the full unfiltered list so the bucket-totals chips
  // and the needsReviewCount chip reflect totals even when filters are
  // active.
  const filteredInvoices = invoices.filter((i) => {
    if (selectedBucket && i.agingBucket !== selectedBucket) return false;
    if (selectedNeedsReview && !i.needsReview) return false;
    return true;
  });

  // When the API didn't return a summary (403 or empty state), fall back
  // to an empty summary so InvoiceList still renders cleanly.
  const safeSummary: InvoiceListSummary = summary ?? {
    totalOutstanding: 0,
    overdueOutstanding: 0,
    bucketTotals: {
      "Paid": { count: 0, amount: 0 },
      "Written off": { count: 0, amount: 0 },
      "Current": { count: 0, amount: 0 },
      "1–30 days": { count: 0, amount: 0 },
      "31–60 days": { count: 0, amount: 0 },
      "61–90 days": { count: 0, amount: 0 },
      "91+ days": { count: 0, amount: 0 },
    },
    needsReviewCount: 0,
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <AppHeader />
      <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/dashboard"
          backLabel="FlowWork"
          title="Invoices"
          subtitle="Track wholesale invoices and chase overdue payments"
        />

        <SectionTip id="invoices" title="Accounts receivable — money owed to you">
          This is AR: invoices <em>you</em> sent that are awaiting payment
          (wholesale, consignment, custom orders). Each one lands in an
          aging bucket so you can see at a glance what&apos;s current vs.
          overdue, then send a polite follow-up in one tap. Looking to log
          a bill you <em>received</em>? That&apos;s an{" "}
          <strong>Expense</strong>, not an invoice.
        </SectionTip>

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

        <div className="flex justify-between items-center mb-5 gap-3 flex-wrap">
          <p className="text-sm text-slate-500 m-0">
            {invoices.length === 0
              ? "No invoices yet."
              : `${invoices.length} ${
                  invoices.length === 1 ? "invoice" : "invoices"
                }`}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Phase 6.5 commit 7: Fetch from Gmail button — Growth+
                only (matches the API guard). Hidden on starter, but
                starter already gets the upgrade-prompt screen at the
                top of the file.
                Sub-session 33: gated behind FEATURES.GMAIL_INGEST so
                the button + modal disappear while we evaluate
                whether to keep the feature. */}
            {FEATURES.GMAIL_INGEST && (
              <button
                type="button"
                onClick={() => setFetchModalOpen(true)}
                className="py-2.5 px-5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50"
              >
                {"\u{1F4E5}"} Fetch from Gmail
              </button>
            )}
            <Link
              href="/invoices/new"
              className="py-2.5 px-6 rounded-lg border-0 bg-blue-500 text-white text-sm font-semibold no-underline cursor-pointer"
            >
              + New invoice
            </Link>
          </div>
        </div>

        <InvoiceList
          invoices={filteredInvoices}
          summary={safeSummary}
          selectedBucket={selectedBucket}
          onSelectBucket={setSelectedBucket}
          selectedNeedsReview={selectedNeedsReview}
          onToggleNeedsReview={() =>
            setSelectedNeedsReview((v) => !v)
          }
          onSendReminder={handleSendReminder}
          sendingReminderId={sendingReminderId}
          onApprove={handleApprove}
          onDismiss={handleDismiss}
          reviewingId={reviewingId}
        />

        {/* Phase 6.5 commit 7: Fetch-from-Gmail modal. Lives at the
            page root so the inset-0 overlay covers the full viewport.
            onFetch resolves with the API response; the modal owns
            the busy/result/error states. After fetch lands, parent
            reloads the list + auto-toggles the review filter on so
            the new rows are immediately visible.
            Sub-session 33: gated behind FEATURES.GMAIL_INGEST so
            no stray code path can open it while the feature is
            hidden. */}
        {FEATURES.GMAIL_INGEST && (
        <FetchFromGmailModal
          open={fetchModalOpen}
          onClose={() => setFetchModalOpen(false)}
          onFetch={async (opts) => {
            const res = await fetch("/api/invoices/ingest", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(opts),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              throw new Error(data.error || `HTTP ${res.status}`);
            }
            // Refresh the list immediately so the new rows + the
            // updated needsReviewCount appear under the modal. Flip
            // the filter on if anything was inserted so the user
            // doesn't have to find the rows manually.
            await loadInvoices();
            if (data.inserted > 0) setSelectedNeedsReview(true);
            return data;
          }}
        />
        )}
      </div>
    </div>
  );
}
