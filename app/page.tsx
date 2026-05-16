"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signOut } from "next-auth/react";
import Spinner from "./components/Spinner";
import ErrorBanner from "./components/ErrorBanner";
import CsvReviewModal from "./components/CsvReviewModal";
import { apiFetch } from "@/lib/apiFetch";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Email {
  id: string;
  subject: string;
  from: string;
  date: string;
  body: string;
  snippet: string;
  labels: string[];
}

interface ProcessedItem {
  id: string;
  vendor: string;
  invoiceNumber: string;
  amount: number;
  dueDate: string;
  status: "pending" | "overdue" | "paid" | "needs_review";
  category: "invoice" | "expense" | "ar_followup";
  confidence: number;
  rawEmailId: string;
  summary: string;
  source: string;
}

type Label = "Invoices" | "AR Follow Up" | "Expenses";
type Tab = "emails" | "processed" | "dashboard";

function formatCallDateTime(d: Date): string {
  const dateStr = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const timeStr = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateStr} at ${timeStr}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Home() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [processedItems, setProcessedItems] = useState<ProcessedItem[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<Label>("Invoices");
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [clientInfo, setClientInfo] = useState<any>(null);
  const router = useRouter();

  // CSV Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadReview, setUploadReview] = useState<any>(null);
  const [reviewRows, setReviewRows] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);

  // Backfill state
  const [backfillRange, setBackfillRange] = useState<string>("");

  // Per-action loading states
  const [updatingStatus, setUpdatingStatus] = useState<Set<string>>(new Set());
  const [deletingItems, setDeletingItems] = useState<Set<string>>(new Set());
  const [clearingSample, setClearingSample] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);

  // Load processed items from database
  const loadItems = useCallback(async () => {
    try {
      const data = await apiFetch<{ items: any[] }>("/api/items");
      const mapped = (data.items || []).map((item: any) => ({
        id: String(item.id),
        vendor: item.vendor,
        invoiceNumber: item.invoice_number || "",
        amount: parseFloat(item.amount) || 0,
        dueDate: item.due_date || "",
        status: item.status || "pending",
        category: item.category || "invoice",
        confidence: item.confidence || 0,
        rawEmailId: item.raw_email_id || "",
        summary: item.summary || "",
        source: item.source || "email",
      }));
      setProcessedItems(mapped);
    } catch (err) {
      setError(err instanceof Error ? `Couldn't load items: ${err.message}` : "Couldn't load items");
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Load client plan info
  useEffect(() => {
    async function loadClient() {
      try {
        const data = await apiFetch<{ onboardingCompleted?: boolean } & Record<string, unknown>>(
          "/api/client"
        );
        if (!data) return;
        setClientInfo(data);
        if (data.onboardingCompleted === false) {
          router.push("/onboarding");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load account info");
      }
    }
    loadClient();
  }, [router]);

  // ─── Fetch emails by label ─────────────────────────────────────────────────

  const fetchEmails = useCallback(async (label: Label) => {
    setLoading(true);
    setError(null);
    setSelectedLabel(label);
    try {
      const data = await apiFetch<{ messages: Email[] }>(
        `/api/gmail?label=${encodeURIComponent(label)}`
      );
      setEmails(data.messages || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't fetch emails");
      setEmails([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Backfill emails ──────────────────────────────────────────────────────

  const fetchBackfill = useCallback(async (label: Label, daysBack: number) => {
    setLoading(true);
    setError(null);
    setSelectedLabel(label);
    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - daysBack);
    const after = afterDate.toISOString().split("T")[0].replace(/-/g, "/");
    try {
      const data = await apiFetch<{ messages: Email[] }>(
        `/api/gmail?label=${encodeURIComponent(label)}&after=${after}&maxResults=100`
      );
      setEmails(data.messages || []);
      setSuccessMsg(`Found ${(data.messages || []).length} emails from the last ${daysBack} days`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't fetch emails");
      setEmails([]);
    } finally {
      setLoading(false);
      setBackfillRange("");
    }
  }, []);

  // ─── Process emails with Claude ────────────────────────────────────────────

  const processWithAI = useCallback(async () => {
    if (emails.length === 0) {
      setError("Fetch emails first before processing");
      return;
    }

    // Plan-gated item limit check
    if (clientInfo?.features?.maxItemsPerMonth !== null && clientInfo?.features?.maxItemsPerMonth !== undefined) {
      const currentCount = processedItems.length;
      const limit = clientInfo.features.maxItemsPerMonth;
      if (currentCount >= limit) {
        setError(`You've reached your ${clientInfo.plan} plan limit of ${limit} items/month. Upgrade to process more.`);
        return;
      }
    }

    setProcessing(true);
    setError(null);
    setSuccessMsg(null);

    const categoryMap: Record<Label, string> = {
      Invoices: "invoice",
      "AR Follow Up": "ar_followup",
      Expenses: "expense",
    };

    try {
      const data = await apiFetch<{ results: ProcessedItem[]; processed: number }>(
        "/api/process",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emails,
            category: categoryMap[selectedLabel],
          }),
        }
      );
      setProcessedItems((prev) => [...data.results, ...prev]);
      setSuccessMsg(`Processed ${data.processed} items from ${selectedLabel}`);
      setActiveTab("processed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI processing failed");
    } finally {
      setProcessing(false);
    }
  }, [emails, selectedLabel, clientInfo, processedItems.length]);

  // ─── Update item status ────────────────────────────────────────────────────
  const updateStatus = useCallback(
    async (id: string, newStatus: ProcessedItem["status"]) => {
      const prevItems = processedItems;
      setUpdatingStatus((s) => new Set(s).add(id));
      setProcessedItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: newStatus } : item
        )
      );
      try {
        await apiFetch("/api/items", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: Number(id), status: newStatus }),
        });
      } catch (err) {
        setProcessedItems(prevItems);
        setError(err instanceof Error ? err.message : "Couldn't update status");
      } finally {
        setUpdatingStatus((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }
    },
    [processedItems]
  );

  // ─── CSV Upload ────────────────────────────────────────────────────────────

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await apiFetch<{ mappedRows: any[]; categories: string[] }>(
        "/api/upload",
        { method: "POST", body: formData }
      );
      setUploadReview(data);
      setReviewRows(
        data.mappedRows.map((r: any, i: number) => ({ ...r, _approved: true, _index: i }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  // ─── Clear sample data ─────────────────────────────────────────────────────

  const clearSampleData = useCallback(async () => {
    if (!confirm("Clear all sample data? You can't undo this.")) return;
    setClearingSample(true);
    setError(null);
    try {
      await apiFetch("/api/sample-data", { method: "DELETE" });
      await loadItems();
      setSuccessMsg("Sample data cleared");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't clear sample data");
    } finally {
      setClearingSample(false);
    }
  }, [loadItems]);

  // ─── Reclassify legacy umbrella items ──────────────────────────────────────

  const handleReclassify = useCallback(async () => {
    setReclassifying(true);
    setError(null);
    try {
      const data = await apiFetch<{
        reclassified: number;
        remaining: number;
        total: number;
      }>("/api/reclassify", { method: "POST" });
      if (data.remaining > 0) {
        setSuccessMsg(
          `Reclassified ${data.reclassified} items. ${data.remaining} remain — click again to continue.`
        );
      } else {
        setSuccessMsg(`Reclassified ${data.reclassified} items. All caught up.`);
      }
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reclassify failed");
    } finally {
      setReclassifying(false);
    }
  }, [loadItems]);

  // ─── Delete item ───────────────────────────────────────────────────────────

  const deleteItem = useCallback(async (id: string) => {
    if (!confirm("Delete this item? This cannot be undone.")) return;
    setDeletingItems((s) => new Set(s).add(id));
    setError(null);
    try {
      await apiFetch("/api/items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: Number(id) }),
      });
      setProcessedItems((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete item");
    } finally {
      setDeletingItems((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const confirmImport = useCallback(async () => {
    const approved = reviewRows.filter((r) => r._approved);
    if (approved.length === 0) {
      setError("No rows selected for import");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const data = await apiFetch<{ imported: number }>("/api/upload/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: approved.map(({ _approved, _index, ...rest }: any) => rest),
        }),
      });
      setSuccessMsg(`Imported ${data.imported} items from CSV`);
      setUploadReview(null);
      setReviewRows([]);
      await loadItems();
      setActiveTab("processed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }, [reviewRows, loadItems]);

  // ─── Dashboard stats ──────────────────────────────────────────────────────

  // Count legacy umbrella-type items (pre-sub-session-11 classifications still
  // showing invoice/expense/ar_followup instead of industry-aware categories).
  // Drives the reclassify banner visibility + button label.
  const UMBRELLA_VALUES: readonly string[] = ["invoice", "expense", "ar_followup"];
  const umbrellaCount = processedItems.filter((i) =>
    UMBRELLA_VALUES.includes(i.category)
  ).length;

  // Pro onboarding-call banner state. Three cases gated on plan === "pro":
  //   not booked → "Book your call" prompt (state 1)
  //   booked, upcoming → "Your call is scheduled for ..." (state 2)
  //   booked, past → hide entirely (state 3, per design decision)
  // Replaces the prior welcome_pro_seen gate — visiting the welcome page is
  // not the same signal as having booked the call.
  const isPro = clientInfo?.plan === "pro";
  const proCallScheduledFor: string | null = clientInfo?.proCallScheduledFor ?? null;
  const proCallBookedAt: string | null = clientInfo?.proCallBookedAt ?? null;
  const proCallTime = proCallScheduledFor ? new Date(proCallScheduledFor) : null;
  const proCallIsPast =
    proCallTime !== null && proCallTime.getTime() <= Date.now();
  const showBookPrompt = isPro && proCallBookedAt === null;
  const showCallConfirmation =
    isPro && proCallBookedAt !== null && proCallTime !== null && !proCallIsPast;

  const stats = {
    total: processedItems.length,
    pending: processedItems.filter((i) => i.status === "pending").length,
    overdue: processedItems.filter((i) => i.status === "overdue").length,
    needsReview: processedItems.filter((i) => i.status === "needs_review").length,
    paid: processedItems.filter((i) => i.status === "paid").length,
    totalAmount: processedItems.reduce((sum, i) => sum + i.amount, 0),
    overdueAmount: processedItems
      .filter((i) => i.status === "overdue")
      .reduce((sum, i) => sum + i.amount, 0),
    avgConfidence:
      processedItems.length > 0
        ? Math.round(
            processedItems.reduce((sum, i) => sum + i.confidence, 0) /
              processedItems.length
          )
        : 0,
  };

  // Determine which labels to show based on plan
  const availableLabels: Label[] = clientInfo?.features?.labels
    ? (clientInfo.features.labels as Label[])
    : ["Invoices", "Expenses"];

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-gradient-to-br from-slate-800 to-slate-700 text-white px-4 sm:px-8 py-6">
        <div className="max-w-[1200px] mx-auto flex justify-between items-center">
          <div>
            <h1 className="m-0 text-2xl sm:text-[28px] font-bold">
              <span className="text-2xl">{"⚡"}</span> FlowWork
            </h1>
            <p className="mt-1 mb-0 mx-0 text-white/70 text-sm hidden sm:block">Accounting Automation</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {clientInfo && (
              <a
                href="/billing"
                className="bg-white/15 text-white px-2 sm:px-4 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-[13px] font-semibold uppercase tracking-wider no-underline cursor-pointer"
              >
                {clientInfo.plan}
              </a>
            )}
            <Link
              href="/settings"
              className="bg-transparent text-white/75 text-[11px] sm:text-[13px] no-underline px-1 py-1.5"
            >
              Settings
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: "/signin" })}
              className="bg-transparent text-white/75 text-[11px] sm:text-[13px] cursor-pointer px-1 py-1.5"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="flex bg-white border-b border-slate-200 px-4 sm:px-8 max-w-[1200px] mx-auto">
        {(["emails", "processed", "dashboard"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-3.5 px-3 sm:px-6 bg-transparent cursor-pointer text-sm font-medium border-b-2 transition-all duration-150 ${
              activeTab === tab
                ? "text-slate-800 border-blue-500"
                : "text-slate-500 border-transparent"
            }`}
          >
            {tab === "emails" && "\u{1F4E7} Emails"}
            {tab === "processed" && `\u{1F4C4} Processed (${processedItems.length})`}
            {tab === "dashboard" && "\u{1F4CA} Dashboard"}
          </button>
        ))}
      </nav>

      <main className="max-w-[1200px] mx-auto px-4 sm:px-8 py-6">
        {/* Status messages */}
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        {successMsg && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-4 text-sm">
            {successMsg}
          </div>
        )}

        {/* Pro onboarding-call: confirmation (state 2 — booked, upcoming) */}
        {showCallConfirmation && proCallTime && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-4 text-sm flex items-center gap-2 flex-wrap">
            <span className="font-medium">
              {"\u{2705}"} Your onboarding call is scheduled for {formatCallDateTime(proCallTime)}.
            </span>
          </div>
        )}

        {/* Pro onboarding-call: prompt (state 1 — not yet booked) */}
        {showBookPrompt && (
          <div className="bg-gradient-to-br from-amber-100 to-amber-200 border border-amber-500 text-amber-900 px-4 py-3 rounded-lg mb-4 text-sm flex justify-between items-center gap-3 flex-wrap">
            <span className="font-medium">
              {"\u{1F3AF}"} <strong>Welcome to Pro!</strong> Book your white-glove onboarding call to get started.
            </span>
            <Link
              href="/welcome-pro"
              className="px-3.5 py-1.5 rounded-md border border-amber-700 bg-white text-amber-900 text-[13px] font-semibold no-underline cursor-pointer"
            >
              Book your call {"→"}
            </Link>
          </div>
        )}

        {/* Reclassify legacy umbrella items banner */}
        {umbrellaCount > 0 && (
          <div className="bg-yellow-50 border border-yellow-300 text-amber-800 px-4 py-3 rounded-lg mb-4 text-sm flex justify-between items-center gap-3 flex-wrap">
            <span className="font-medium">
              {"\u{2728}"} {umbrellaCount} legacy item{umbrellaCount === 1 ? "" : "s"} can be reclassified into industry-aware categories.
            </span>
            <button
              onClick={handleReclassify}
              disabled={reclassifying}
              className="px-3.5 py-1.5 rounded-md border border-yellow-600 bg-white text-amber-800 text-[13px] font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait"
            >
              {reclassifying && <Spinner size={12} color="#854d0e" />}
              {reclassifying
                ? "Reclassifying..."
                : `Reclassify ${umbrellaCount} legacy item${umbrellaCount === 1 ? "" : "s"}`}
            </button>
          </div>
        )}

        {/* Sample data banner */}
        {processedItems.some((i) => i.source === "sample") && (
          <div className="bg-yellow-50 border border-yellow-300 text-amber-800 px-4 py-3 rounded-lg mb-4 text-sm flex justify-between items-center gap-3 flex-wrap">
            <span className="font-medium">
              {"\u{1F4A1}"} You&apos;re viewing sample data. Clear it when you&apos;re ready to add real data.
            </span>
            <button
              onClick={clearSampleData}
              disabled={clearingSample}
              className="px-3.5 py-1.5 rounded-md border border-yellow-600 bg-white text-amber-800 text-[13px] font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait"
            >
              {clearingSample && <Spinner size={12} color="#854d0e" />}
              {clearingSample ? "Clearing..." : "Clear sample data"}
            </button>
          </div>
        )}

        {/* ── EMAILS TAB ── */}
        {activeTab === "emails" && (
          <>
            {/* Label selector + actions */}
            <div className="flex justify-between items-center mb-5 flex-wrap gap-3">
              <div className="flex flex-wrap gap-2">
                {availableLabels.map((label) => (
                  <button
                    key={label}
                    onClick={() => fetchEmails(label)}
                    className={`py-2.5 px-4 rounded-lg border cursor-pointer text-[13px] font-medium transition-all duration-150 ${
                      selectedLabel === label
                        ? "bg-slate-800 text-white border-slate-800"
                        : "bg-white text-slate-600 border-slate-200"
                    }`}
                  >
                    {label === "Invoices" && "\u{1F4D1}"}
                    {label === "AR Follow Up" && "\u{1F514}"}
                    {label === "Expenses" && "\u{1F4B3}"}{" "}
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={processWithAI}
                  disabled={processing || emails.length === 0}
                  className="py-2.5 px-6 rounded-lg bg-green-600 text-white cursor-pointer text-sm font-semibold transition-all duration-150 inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processing ? <Spinner size={14} color="white" /> : <span>{"\u{1F916}"}</span>}
                  {processing ? "Processing..." : "Process with AI"}
                </button>

                <label
                  className={`py-2.5 px-6 rounded-lg bg-blue-500 text-white text-sm font-semibold transition-all duration-150 inline-flex items-center gap-2 m-0 ${
                    uploading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                  }`}
                >
                  {uploading ? <Spinner size={14} color="white" /> : <span>{"\u{1F4C1}"}</span>}
                  {uploading ? "Analyzing..." : "Upload CSV"}
                  <input
                    type="file"
                    accept=".csv,.tsv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUpload(f);
                      e.target.value = "";
                    }}
                    disabled={uploading}
                  />
                </label>

                <div className="relative inline-flex items-center">
                  <select
                    value={backfillRange}
                    disabled={loading}
                    onChange={(e) => {
                      if (e.target.value) {
                        setBackfillRange(e.target.value);
                        fetchBackfill(selectedLabel, parseInt(e.target.value));
                      }
                    }}
                    className={`py-2.5 px-3 rounded-lg border border-slate-200 bg-white text-[13px] text-slate-600 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                      loading ? "pr-9" : ""
                    }`}
                  >
                    <option value="">{loading ? "Backfilling..." : "Backfill..."}</option>
                    <option value="30">Last 30 days</option>
                    <option value="60">Last 60 days</option>
                    <option value="90">Last 90 days</option>
                    <option value="180">Last 6 months</option>
                    <option value="365">Last year</option>
                  </select>
                  {loading && (
                    <div className="absolute right-2.5 pointer-events-none text-slate-600">
                      <Spinner size={14} />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Email list */}
            {loading ? (
              <div className="text-center p-[60px] text-slate-500 text-[15px]">
                <div className="inline-flex items-center gap-2.5 text-slate-500">
                  <Spinner size={20} />
                  <span>Loading emails...</span>
                </div>
              </div>
            ) : emails.length === 0 ? (
              <div className="text-center p-[60px] text-slate-400 text-[15px]">
                <p className="text-5xl mb-2">{"\u{1F4ED}"}</p>
                <p>Select a label above to fetch emails</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {emails.map((email) => (
                  <div
                    key={email.id}
                    className="bg-white rounded-[10px] py-4 px-5 border border-slate-200 transition-shadow duration-150"
                  >
                    <div className="flex justify-between mb-1.5">
                      <span className="text-[13px] font-semibold text-slate-800">{email.from}</span>
                      <span className="text-xs text-slate-400">
                        {new Date(email.date).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-slate-700 mb-1">{email.subject}</div>
                    <div className="text-[13px] text-slate-500 leading-snug">
                      {email.snippet || email.body?.substring(0, 120)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── PROCESSED TAB ── */}
        {activeTab === "processed" && (
          <>
            {processedItems.length === 0 ? (
              <div className="text-center p-[60px] text-slate-400 text-[15px]">
                <p className="text-5xl mb-2">{"\u{1F4CB}"}</p>
                <p>No processed items yet. Fetch emails and click Process with AI.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
                {processedItems.map((item) => (
                  <div key={item.id} className="bg-white rounded-xl border border-slate-200">
                    {/* Card header with status badge */}
                    <div className="flex justify-between items-center pt-4 px-5 pb-3 border-b border-slate-100">
                      <span className="text-base font-bold text-slate-900">{item.vendor}</span>
                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider ${statusBadgeClasses(
                          item.status
                        )}`}
                      >
                        {item.status.replace("_", " ")}
                      </span>
                    </div>

                    {/* Card body */}
                    <div className="py-3 px-5">
                      <div className="flex justify-between py-1.5 border-b border-slate-50">
                        <span className="text-[13px] text-slate-500">Invoice #</span>
                        <span className="text-[13px] font-medium text-slate-800">{item.invoiceNumber}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-50">
                        <span className="text-[13px] text-slate-500">Amount</span>
                        <span className="text-[15px] font-bold text-slate-900">
                          ${item.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-50">
                        <span className="text-[13px] text-slate-500">Due Date</span>
                        <span className="text-[13px] font-medium text-slate-800">
                          {item.dueDate
                            ? new Date(item.dueDate).toLocaleDateString("en-US", {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })
                            : "-"}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-50">
                        <span className="text-[13px] text-slate-500">Category</span>
                        <span className="text-[13px] font-medium text-slate-800">{item.category}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-50">
                        <span className="text-[13px] text-slate-500">Confidence</span>
                        <span
                          className={`text-[13px] font-medium ${
                            item.confidence >= 80
                              ? "text-green-600"
                              : item.confidence >= 50
                              ? "text-yellow-600"
                              : "text-red-600"
                          }`}
                        >
                          {item.confidence}%
                        </span>
                      </div>
                    </div>

                    {/* Summary */}
                    <p className="pt-2 px-5 pb-3 text-xs text-slate-500 leading-normal m-0">{item.summary}</p>

                    {/* Status actions */}
                    <div className="flex gap-1 pt-2 px-4 pb-3 border-t border-slate-100">
                      {(["pending", "paid", "overdue", "needs_review"] as const).map((s) => {
                        const isUpdating = updatingStatus.has(item.id);
                        const isActive = item.status === s;
                        return (
                          <button
                            key={s}
                            onClick={() => updateStatus(item.id, s)}
                            disabled={isUpdating}
                            className={`flex-1 p-1.5 border rounded-md cursor-pointer text-base transition-all duration-150 inline-flex items-center justify-center disabled:opacity-60 disabled:cursor-wait ${
                              isActive
                                ? "bg-slate-100 border-slate-400"
                                : "bg-white border-slate-200"
                            }`}
                          >
                            {isUpdating && isActive ? (
                              <Spinner size={14} color="#475569" />
                            ) : (
                              <>
                                {s === "pending" && "⌛"}
                                {s === "paid" && "✅"}
                                {s === "overdue" && "\u{1F6A8}"}
                                {s === "needs_review" && "\u{1F440}"}
                              </>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <div className="px-4 pb-3 text-right">
                      <button
                        onClick={() => deleteItem(item.id)}
                        disabled={deletingItems.has(item.id)}
                        className="bg-transparent text-slate-400 text-xs cursor-pointer disabled:cursor-wait px-2 py-1 inline-flex items-center gap-1.5"
                      >
                        {deletingItems.has(item.id) && <Spinner size={11} color="#94a3b8" />}
                        {deletingItems.has(item.id) ? "Removing..." : "Remove"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── DASHBOARD TAB ── */}
        {activeTab === "dashboard" && (
          <div>
            {/* Stat cards */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 mb-8">
              <StatCard
                label="Total Items"
                value={stats.total}
                icon={"\u{1F4E6}"}
                colorClass="border-t-blue-500"
              />
              <StatCard
                label="Total Amount"
                value={`$${stats.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
                icon={"\u{1F4B0}"}
                colorClass="border-t-green-600"
              />
              <StatCard
                label="Overdue"
                value={stats.overdue}
                sub={`$${stats.overdueAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
                icon={"\u{1F6A8}"}
                colorClass="border-t-red-600"
              />
              <StatCard
                label="Avg Confidence"
                value={`${stats.avgConfidence}%`}
                icon={"\u{1F3AF}"}
                colorClass="border-t-violet-500"
              />
            </div>

            {/* Status breakdown */}
            <div>
              <h3 className="text-lg font-bold text-slate-900 mb-4">Status Breakdown</h3>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
                {[
                  { label: "Pending", count: stats.pending, borderClass: "border-l-amber-500", icon: "⌛" },
                  { label: "Overdue", count: stats.overdue, borderClass: "border-l-red-600", icon: "\u{1F6A8}" },
                  { label: "Needs Review", count: stats.needsReview, borderClass: "border-l-indigo-500", icon: "\u{1F440}" },
                  { label: "Paid", count: stats.paid, borderClass: "border-l-green-600", icon: "✅" },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={`bg-white rounded-[10px] py-4 px-5 flex items-center gap-3 border border-slate-200 border-l-4 ${item.borderClass}`}
                  >
                    <span className="text-xl">{item.icon}</span>
                    <span className="text-2xl font-extrabold text-slate-900">{item.count}</span>
                    <span className="text-[13px] text-slate-500">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {processedItems.length === 0 && (
              <div className="text-center p-[60px] text-slate-400 text-[15px]">
                <p className="text-5xl mb-2">{"\u{1F4CA}"}</p>
                <p>Process some emails to see dashboard data</p>
              </div>
            )}
          </div>
        )}

        {/* ── CSV REVIEW MODAL ── */}
        <CsvReviewModal
          uploadReview={uploadReview}
          reviewRows={reviewRows}
          setReviewRows={setReviewRows}
          onCancel={() => {
            setUploadReview(null);
            setReviewRows([]);
          }}
          onConfirm={confirmImport}
          importing={importing}
        />
      </main>
      <footer className="max-w-[1200px] mx-auto mt-8 pt-5 px-4 sm:px-8 pb-8 text-[13px] text-slate-400 text-center">
        <a href="/privacy" className="text-slate-500 no-underline mx-1.5">
          Privacy
        </a>
        <span className="text-slate-300">{"·"}</span>
        <a href="/terms" className="text-slate-500 no-underline mx-1.5">
          Terms
        </a>
      </footer>
    </div>
  );
}

// ─── Stat Card Component ─────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon,
  colorClass,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: string;
  colorClass: string;
}) {
  return (
    <div
      className={`bg-white rounded-xl p-6 text-center border border-slate-200 border-t-[3px] ${colorClass}`}
    >
      <div className="text-[28px] mb-2">{icon}</div>
      <div className="text-[28px] font-extrabold text-slate-900">{value}</div>
      <div className="text-[13px] text-slate-500 mt-1">{label}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Status badge classes ────────────────────────────────────────────────────

function statusBadgeClasses(status: string): string {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    overdue: "bg-red-100 text-red-800",
    paid: "bg-green-100 text-green-800",
    needs_review: "bg-indigo-100 text-indigo-800",
  };
  return map[status] || "";
}
