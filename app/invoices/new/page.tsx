"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "../../components/PageHeader";
import ErrorBanner from "../../components/ErrorBanner";
import InvoiceCreateForm, {
  type InvoiceSubmitPayload,
} from "../../components/InvoiceCreateForm";

// Phase 6 manual invoice entry. Mirror events-page conventions for
// plan-gating + loading + error handling. On successful POST, redirects
// to the new invoice's detail page (commit 6).

interface MinimalInvoice {
  customerName: string;
}

interface ListResponse {
  invoices: MinimalInvoice[];
}

export default function NewInvoicePage() {
  const router = useRouter();
  const [plan, setPlan] = useState<string | null>(null);
  const [existingCustomerNames, setExistingCustomerNames] = useState<string[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const clientRes = await fetch("/api/client");
        if (clientRes.status === 401) {
          router.replace("/signin?callbackUrl=/invoices/new");
          return;
        }
        if (!clientRes.ok) {
          setError(`Couldn't load account: HTTP ${clientRes.status}`);
          return;
        }
        const clientData = await clientRes.json();
        setPlan(clientData.plan);

        // Starter sees upgrade prompt; no need to fetch existing customers.
        if (clientData.plan === "starter") return;

        // Fetch existing customer names for the autocomplete datalist.
        // Soft-fail: if the list endpoint errors, the form still works
        // without autocomplete.
        try {
          const listRes = await fetch("/api/invoices?limit=1000");
          if (listRes.ok) {
            const data: ListResponse = await listRes.json();
            const unique = Array.from(
              new Set((data.invoices || []).map((i) => i.customerName))
            ).sort((a, b) => a.localeCompare(b));
            setExistingCustomerNames(unique);
          }
        } catch {
          // Non-fatal — leave existingCustomerNames empty.
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load page");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  const handleSubmit = async (p: InvoiceSubmitPayload) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data: { invoice: { id: number } } = await res.json();
      router.push(`/invoices/${data.invoice.id}`);
    } catch (err) {
      setSaving(false);
      throw err; // Re-throw so InvoiceCreateForm can surface the error.
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[700px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (plan === "starter") {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[700px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/invoices"
            backLabel="Invoices"
            title="New invoice"
          />
          <div className="bg-amber-50 border border-amber-200 rounded-xl py-8 px-6 text-center">
            <p className="text-base font-medium text-amber-900 m-0 mb-2">
              {"\u{1F512}"} AR Aging is a Growth-and-Pro feature
            </p>
            <p className="text-sm text-amber-800 m-0 mb-5 leading-relaxed">
              Upgrade to Growth ($49/mo) to start tracking invoices.
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

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-[700px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/invoices"
          backLabel="Invoices"
          title="New invoice"
          subtitle="Manual entry. Net 30 by default."
        />

        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        )}

        <InvoiceCreateForm
          existingCustomerNames={existingCustomerNames}
          onSubmit={handleSubmit}
          onCancel={() => router.push("/invoices")}
          saving={saving}
        />
      </div>
    </div>
  );
}
