"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "../components/PageHeader";
import ErrorBanner from "../components/ErrorBanner";
import InvoiceList, {
  type InvoiceListEntry,
  type InvoiceListSummary,
} from "../components/InvoiceList";
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
        if (clientData.plan === "starter") return;

        await loadInvoices();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load page");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router, loadInvoices]);

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

  if (plan === "starter") {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/"
            backLabel="FlowWork"
            title="Invoices"
            subtitle="Track wholesale invoices and chase overdue payments"
          />
          <div className="bg-amber-50 border border-amber-200 rounded-xl py-8 px-6 text-center">
            <p className="text-base font-medium text-amber-900 m-0 mb-2">
              {"\u{1F512}"} AR Aging is a Growth-and-Pro feature
            </p>
            <p className="text-sm text-amber-800 m-0 mb-5 leading-relaxed">
              Upgrade to Growth ($49/mo) to track wholesale and consignment
              invoices, see aging buckets at a glance, and send polite
              follow-ups in one tap.
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

  // Apply the bucket filter client-side. Summary stays computed over the
  // full unfiltered list so the bucket-totals chips reflect totals even
  // when one is selected.
  const filteredInvoices = selectedBucket
    ? invoices.filter((i) => i.agingBucket === selectedBucket)
    : invoices;

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
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/"
          backLabel="FlowWork"
          title="Invoices"
          subtitle="Track wholesale invoices and chase overdue payments"
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

        <div className="flex justify-between items-center mb-5 gap-3 flex-wrap">
          <p className="text-sm text-slate-500 m-0">
            {invoices.length === 0
              ? "No invoices yet."
              : `${invoices.length} ${
                  invoices.length === 1 ? "invoice" : "invoices"
                }`}
          </p>
          <Link
            href="/invoices/new"
            className="py-2.5 px-6 rounded-lg border-0 bg-blue-500 text-white text-sm font-semibold no-underline cursor-pointer"
          >
            + New invoice
          </Link>
        </div>

        <InvoiceList
          invoices={filteredInvoices}
          summary={safeSummary}
          selectedBucket={selectedBucket}
          onSelectBucket={setSelectedBucket}
          onSendReminder={handleSendReminder}
          sendingReminderId={sendingReminderId}
        />
      </div>
    </div>
  );
}
