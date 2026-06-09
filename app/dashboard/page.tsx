"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Spinner from "../components/Spinner";
import AppHeader from "../components/AppHeader";
import ErrorBanner from "../components/ErrorBanner";
import CsvReviewModal from "../components/CsvReviewModal";
import ConfirmModal from "../components/ConfirmModal";
import EventCreateForm, { type EventResponse } from "../components/EventCreateForm";
import type { ChannelRow } from "../components/ChannelTable";
import SalesBanner from "../components/SalesBanner";
import ActionItemsStrip from "../components/ActionItemsStrip";
import ChannelStack from "../components/ChannelStack";
import CogsSummaryCard from "../components/CogsSummaryCard";
import ReclassifyModal, {
  type ReclassifyModalRow,
} from "../components/ReclassifyModal";
import UpcomingEventsCard, {
  type UpcomingEvent,
} from "../components/UpcomingEventsCard";
import { apiFetch } from "@/lib/apiFetch";
import { AGING_BUCKETS_ORDERED, isOverdue, type AgingBucket } from "@/lib/aging";
import { FEATURES } from "@/lib/features";
import { isPayingTier } from "@/lib/plans";

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
  category: string;
  confidence: number;
  rawEmailId: string;
  summary: string;
  source: string;
  // Phase 13: current channel assignment. Drives the
  // "Currently in X" preview in the ReclassifyModal + powers
  // future per-channel filters on this tab.
  channel: string | null;
}

type Label = "Invoices" | "AR Follow Up" | "Expenses";
type Tab = "emails" | "processed" | "dashboard";

// Sub-session 33: status-button metadata for the Processed-tab
// cards. icon + short label + hover tooltip so the four status
// buttons are self-explanatory instead of a row of bare emoji.
const STATUS_BUTTON_META: Record<
  "pending" | "paid" | "overdue" | "needs_review",
  { icon: string; label: string; title: string }
> = {
  pending: { icon: "⌛", label: "Pending", title: "Pending — awaiting payment" },
  paid: { icon: "✅", label: "Paid", title: "Paid — money received, archive from inbox" },
  overdue: { icon: "\u{1F6A8}", label: "Overdue", title: "Overdue — past due date, needs follow-up" },
  needs_review: { icon: "\u{1F440}", label: "Review", title: "Needs review — something looks off, check later" },
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function Home() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [processedItems, setProcessedItems] = useState<ProcessedItem[]>([]);

  // Phase 13: per-row channel reclassify modal. Set to the row
  // being reclassified; null when the modal is closed.
  const [reclassifyRow, setReclassifyRow] =
    useState<ReclassifyModalRow | null>(null);
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

  // Event auto-coding state — Phase 3 sub-session 17. The selector drives
  // which event uploaded CSV rows auto-code to. "auto" runs per-row date
  // matching in /api/upload (commit 7); a numeric string is a specific
  // event id (batch-tag all rows); "create" toggles the inline form.
  const [availableEvents, setAvailableEvents] = useState<EventResponse[]>([]);
  const [selectedEventChoice, setSelectedEventChoice] = useState<string>("auto");
  const [showInlineEventForm, setShowInlineEventForm] = useState(false);

  // Backfill state
  const [backfillRange, setBackfillRange] = useState<string>("");

  // Per-action loading states
  const [updatingStatus, setUpdatingStatus] = useState<Set<string>>(new Set());
  const [deletingItems, setDeletingItems] = useState<Set<string>>(new Set());
  const [clearingSample, setClearingSample] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);

  // Phase 6: AR summary for the dashboard outstanding-balance card.
  // Fetched only when the plan supports AR ("ar" module = Growth + Pro
  // + trial-courtesy). Null while loading or for excluded plans.
  const [arSummary, setArSummary] = useState<{
    totalOutstanding: number;
    overdueOutstanding: number;
    invoiceCount: number;
    largestOverdueBucket: AgingBucket | null;
    largestOverdueAmount: number;
  } | null>(null);

  // Phase 9.1: channel profitability data + view state. Channels load
  // independently of items/AR/events because the API does its own
  // server-side aggregation. Null until first fetch returns.
  const [channelData, setChannelData] = useState<{
    channels: ChannelRow[];
    overhead: number;
    totalRevenue: number;
    netProfit: number;
  } | null>(null);
  const [channelMode, setChannelMode] = useState<"attributable" | "allocated">(
    "attributable"
  );
  // Phase 9.1 commit 6: time-range picker. Default 'ytd' (current
  // year) — matches the /reports + /profitability conventions. Full
  // year selector lives on /profitability; the dashboard sticks to
  // year-only since it's the high-level summary view.
  const dashboardCurrentYear = new Date().getUTCFullYear();
  const [channelYear, setChannelYear] = useState<number>(dashboardCurrentYear);
  const [collapsedChannels, setCollapsedChannels] = useState<string[]>([]);
  const [collapsedChannelsLoaded, setCollapsedChannelsLoaded] = useState(false);

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
        channel: item.channel ?? null,
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

  // Load events for the upload event-selector. Gated on Growth+/Pro/trial
  // — Starter clients see no selector (Events is a Growth-and-Pro feature
  // per design §6). /api/events returns 403 for Starter, which we treat
  // as "no events available" silently.
  useEffect(() => {
    const plan = clientInfo?.plan;
    if (!isPayingTier(plan)) return;
    let cancelled = false;
    async function loadEvents() {
      try {
        const res = await fetch("/api/events");
        if (!res.ok) return;
        const data = (await res.json()) as { events?: EventResponse[] };
        if (!cancelled) setAvailableEvents(data.events || []);
      } catch {
        // Non-fatal — uploads still work, just without the selector.
      }
    }
    loadEvents();
    return () => {
      cancelled = true;
    };
  }, [clientInfo?.plan]);

  // Phase 6: AR summary fetch for the dashboard outstanding-balance card.
  // Plan-gated on trial/growth/pro (matches /api/invoices isPlanAllowed).
  // Soft-fail: dashboard renders without the AR card if the endpoint
  // errors. Limit 1000 to maximize summary accuracy across all invoices
  // (the API computes summary over the limited rows; at FlowWork scale
  // 1000 covers every realistic vendor caseload).
  useEffect(() => {
    const plan = clientInfo?.plan;
    if (!isPayingTier(plan)) return;
    let cancelled = false;
    async function loadAr() {
      try {
        const res = await fetch("/api/invoices?limit=1000");
        if (!res.ok) return;
        const data = (await res.json()) as {
          invoices: Array<{ status: string }>;
          summary: {
            totalOutstanding: number;
            overdueOutstanding: number;
            bucketTotals: Record<AgingBucket, { count: number; amount: number }>;
          };
        };
        if (cancelled) return;

        // Largest overdue bucket = max amount across the overdue buckets
        // (1–30, 31–60, 61–90, 91+). Used by the "largest bucket: X" copy.
        let largestBucket: AgingBucket | null = null;
        let largestAmount = 0;
        for (const bucket of AGING_BUCKETS_ORDERED) {
          if (!isOverdue(bucket)) continue;
          const amt = data.summary.bucketTotals[bucket]?.amount ?? 0;
          if (amt > largestAmount) {
            largestAmount = amt;
            largestBucket = bucket;
          }
        }

        // Count only non-terminal invoices (open / partial) for the
        // dashboard headline "N invoices" copy.
        const invoiceCount = (data.invoices || []).filter(
          (i) => i.status !== "paid" && i.status !== "written_off"
        ).length;

        setArSummary({
          totalOutstanding: data.summary.totalOutstanding,
          overdueOutstanding: data.summary.overdueOutstanding,
          invoiceCount,
          largestOverdueBucket: largestBucket,
          largestOverdueAmount: largestAmount,
        });
      } catch {
        // Non-fatal — dashboard still renders without the AR card.
      }
    }
    loadAr();
    return () => {
      cancelled = true;
    };
  }, [clientInfo?.plan]);

  // Phase 9.1: load the user's collapsed-channels preference + the
  // channel-table data. Two separate fetches:
  //  1. /api/settings → reads preferences.ux.dashboard.collapsed_channels
  //     (default = collapse coming-soon channels for clean first-paint)
  //  2. /api/profitability/channels?year=X&mode=Y → the aggregation
  // Both are plan-gated (growth+pro+trial); skip for excluded plans.
  useEffect(() => {
    const plan = clientInfo?.plan;
    if (!isPayingTier(plan)) return;
    let cancelled = false;
    async function loadCollapsedPref() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) {
          if (!cancelled) {
            // Default: collapse the 3 coming-soon channels so the
            // initial dashboard view isn't cluttered with rows the
            // user can't act on yet.
            setCollapsedChannels([
              // Phase 9.2 default: only Shopify + Markets visible
              // on the dashboard by default per Jacob's redesign.
              // User restores any channel via "Add another channel"
              // in the ChannelStack.
              "wholesale",
              "service",
              "gmail",
              "uploads",
              "etsy",
              "square",
              "woocommerce",
            ]);
            setCollapsedChannelsLoaded(true);
          }
          return;
        }
        const data = (await res.json()) as {
          settings?: { preferences?: Record<string, unknown> };
        };
        if (cancelled) return;
        const ux =
          data.settings?.preferences?.ux &&
          typeof data.settings.preferences.ux === "object"
            ? (data.settings.preferences.ux as Record<string, unknown>)
            : {};
        const dashPref =
          ux.dashboard && typeof ux.dashboard === "object"
            ? (ux.dashboard as Record<string, unknown>)
            : {};
        const collapsed = Array.isArray(dashPref.collapsed_channels)
          ? (dashPref.collapsed_channels as string[]).filter(
              (v) => typeof v === "string"
            )
          : [
              // Phase 9.2 default: only Shopify + Markets visible
              // on the dashboard by default per Jacob's redesign.
              // User restores any channel via "Add another channel"
              // in the ChannelStack.
              "wholesale",
              "service",
              "gmail",
              "uploads",
              "etsy",
              "square",
              "woocommerce",
            ];
        setCollapsedChannels(collapsed);
        setCollapsedChannelsLoaded(true);
      } catch {
        if (!cancelled) {
          setCollapsedChannels([
              // Phase 9.2 default: only Shopify + Markets visible
              // on the dashboard by default per Jacob's redesign.
              // User restores any channel via "Add another channel"
              // in the ChannelStack.
              "wholesale",
              "service",
              "gmail",
              "uploads",
              "etsy",
              "square",
              "woocommerce",
            ]);
          setCollapsedChannelsLoaded(true);
        }
      }
    }
    loadCollapsedPref();
    return () => {
      cancelled = true;
    };
  }, [clientInfo?.plan]);

  // Channel data fetch — re-runs when the mode toggles (different
  // query param). Year defaults to current; YTD picker in commit 6.
  useEffect(() => {
    const plan = clientInfo?.plan;
    if (!isPayingTier(plan)) return;
    let cancelled = false;
    async function loadChannels() {
      try {
        const res = await fetch(
          `/api/profitability/channels?year=${channelYear}&mode=${channelMode}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          channels: ChannelRow[];
          overhead: number;
          totalRevenue: number;
          netProfit: number;
        };
        if (cancelled) return;
        setChannelData({
          channels: data.channels,
          overhead: data.overhead,
          totalRevenue: data.totalRevenue,
          netProfit: data.netProfit,
        });
      } catch {
        // Soft-fail — dashboard renders without the table.
      }
    }
    loadChannels();
    return () => {
      cancelled = true;
    };
  }, [clientInfo?.plan, channelMode, channelYear]);

  // Phase 9.1: toggle a channel's collapse state. Optimistic update
  // (local state flips immediately) + PATCH /api/settings in the
  // background. If the PATCH fails, the local state stays — the user
  // sees their action take effect; next reload re-reads the persisted
  // state and reverts. Acceptable tradeoff for UX responsiveness.
  const toggleChannelCollapse = useCallback(
    (channelId: string) => {
      setCollapsedChannels((prev) => {
        const next = prev.includes(channelId)
          ? prev.filter((id) => id !== channelId)
          : [...prev, channelId];
        // Fire-and-forget persistence
        fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            preferences: {
              ux: {
                dashboard: { collapsed_channels: next },
              },
            },
          }),
        }).catch(() => {
          // Non-fatal — local state already updated
        });
        return next;
      });
    },
    []
  );

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

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      setSuccessMsg(null);
      try {
        const formData = new FormData();
        formData.append("file", file);
        // If the user picked a specific event, batch-tag all rows. "auto"
        // (default) and "create" (transient state) both omit eventId →
        // /api/upload runs per-row date matching (commit 7).
        if (
          selectedEventChoice !== "auto" &&
          selectedEventChoice !== "create" &&
          /^\d+$/.test(selectedEventChoice)
        ) {
          formData.append("eventId", selectedEventChoice);
        }
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
    },
    [selectedEventChoice]
  );

  // ─── Clear sample data ─────────────────────────────────────────────────────
  //
  // UX commit 1 (sub-session 24): swapped the legacy window.confirm()
  // for the shared <ConfirmModal>. The modal-open state lives at the
  // page level; the actual mutation is unchanged. requestClearSample()
  // opens the modal; confirmClearSample() runs the DELETE.

  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  // UX commit 4 (sub-session 24): drives the Processed-tab status
  // filter when a user clicks one of the Status Breakdown pills on
  // the Dashboard. Null = no filter. Cleared via the chip on the
  // Processed tab.
  const [processedStatusFilter, setProcessedStatusFilter] = useState<
    "pending" | "overdue" | "needs_review" | "paid" | null
  >(null);

  // Sub-session 32 polish: Processed tab as an inbox, not a log.
  // Default-hides rows in a settled state (status === "paid") so the
  // tab represents work that still needs attention. Cleared by the
  // "Show N settled" toggle on the tab itself. Status-filter chip
  // (above) takes precedence when active — clicking a dashboard pill
  // for "paid" should still surface paid rows even with this on.
  const [hideSettled, setHideSettled] = useState<boolean>(true);



  const requestClearSample = useCallback(() => {
    setConfirmClearOpen(true);
  }, []);

  const confirmClearSample = useCallback(async () => {
    setClearingSample(true);
    setError(null);
    try {
      // UX commit 6: surface the count instead of a generic message.
      // The DELETE route returns { deleted: number }; rowCount=0 is
      // a clean no-op (sample data already cleared) — message that
      // distinctly so the user understands the click did the right
      // thing even when nothing changed.
      const data = (await apiFetch<{ deleted?: number }>("/api/sample-data", {
        method: "DELETE",
      })) as { deleted?: number } | null;
      await loadItems();
      const deleted =
        data && typeof data.deleted === "number" ? data.deleted : 0;
      setSuccessMsg(
        deleted === 0
          ? "Sample data was already cleared."
          : `Cleared ${deleted} sample item${deleted === 1 ? "" : "s"}.`
      );
      setConfirmClearOpen(false);
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

  // Phase 4: total business miles across all events. Sums totalMiles (the
  // §8.2 conditional product computed in /api/events GET). availableEvents
  // is already loaded for the upload event-selector (sub-session 17
  // commit 6), so this reuses existing state — no additional fetch.
  const totalBusinessMiles = availableEvents.reduce(
    (sum, e) => sum + (typeof e.totalMiles === "number" ? e.totalMiles : 0),
    0
  );

  // Phase 9.2: categoryStats derivation removed — Top Categories
  // section moved off the dashboard (now lives on /reports as the
  // by-category breakdown). The dashboard's command-center
  // positioning prioritizes channel-level decision support over
  // category-level expense buckets.

  // Phase 9.2: upcoming events for the right-column card. Filters
  // availableEvents (already loaded for the upload event selector)
  // where start_date >= today, sorted by start_date ASC. Limit
  // imposed by the UpcomingEventsCard's visibleLimit prop.
  const todayIso = (() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  })();
  const upcomingEvents: UpcomingEvent[] = availableEvents
    .filter((e) => e.startDate >= todayIso)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((e) => ({
      id: e.id,
      name: e.name,
      startDate: e.startDate,
      endDate: e.endDate,
      venue: e.venue,
    }));

  // Count legacy umbrella-type items (pre-sub-session-11 classifications still
  // showing invoice/expense/ar_followup instead of industry-aware categories).
  // Drives the reclassify banner visibility + button label.
  const UMBRELLA_VALUES = ["invoice", "expense", "ar_followup"];
  const umbrellaCount = processedItems.filter((i) =>
    UMBRELLA_VALUES.includes(i.category)
  ).length;

  // Sub-session 33: the Pro onboarding-call offering was removed.
  // The dashboard book-your-call prompt + scheduled-call
  // confirmation banners are gone with it.

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
      {/* Sub-session 33: header extracted to the shared AppHeader.
          The dashboard supplies plan + the inline-upload handler so
          its Upload entry stays a file picker (the CSV review modal
          lives on this page). */}
      <AppHeader
        plan={clientInfo?.plan ?? null}
        onUploadFile={handleUpload}
        uploading={uploading}
      />

      {/* Phase 9.2: ActionItemsStrip — pill row showing pending user
          actions (Needs Review count + Overdue $). Auto-hides when
          both are zero. Lives below the top nav header per Jacob's
          "under the invoices at the top by settings" placement
          guidance — surfaces actionable items prominently without
          cluttering the main content area. */}
      <ActionItemsStrip
        needsReviewCount={stats.needsReview}
        overdueAmount={arSummary?.overdueOutstanding ?? 0}
        loading={!clientInfo}
      />

      {/* Navigation Tabs. Sub-session 33: Emails tab filtered out
          when FEATURES.GMAIL_INGEST is false. Tab type stays
          intact so the rest of the component still typechecks. */}
      <nav className="flex bg-white border-b border-slate-200 px-4 sm:px-8 max-w-[1200px] mx-auto">
        {(FEATURES.GMAIL_INGEST
          ? (["emails", "processed", "dashboard"] as Tab[])
          : (["processed", "dashboard"] as Tab[])
        ).map((tab) => (
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
            {/* Sub-session 32 polish: badge reflects what's visible.
                When hideSettled is on (default), show only the count
                of actionable rows. When off, show the full count.
                Stops the "Processed (8)" lying when 7 of them are
                hidden by the inbox filter. */}
            {tab === "processed" && (
              <>
                {"\u{1F4C4} Processed ("}
                {hideSettled && processedStatusFilter === null
                  ? processedItems.filter((i) => i.status !== "paid").length
                  : processedItems.length}
                {")"}
              </>
            )}
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

        {/* Sample data banner. Flow-redesign commit 6: unconditional
            again — SetupChecklist moved to /onboarding. The dashboard-
            tab tint (UX commit 5) still renders alongside this banner. */}
        {processedItems.some((i) => i.source === "sample") && (
            <div className="bg-yellow-50 border border-yellow-300 text-amber-800 px-4 py-3 rounded-lg mb-4 text-sm flex justify-between items-center gap-3 flex-wrap">
              <span className="font-medium">
                {"\u{1F4A1}"} You&apos;re viewing sample data. Clear it when
                you&apos;re ready to add real data.
              </span>
              <button
                onClick={requestClearSample}
                disabled={clearingSample}
                className="px-3.5 py-1.5 rounded-md border border-yellow-600 bg-white text-amber-800 text-[13px] font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait"
              >
                {clearingSample && <Spinner size={12} color="#854d0e" />}
                {clearingSample ? "Clearing..." : "Clear sample data"}
              </button>
            </div>
          )}

        {/* ── EMAILS TAB ──
            Sub-session 33: gated behind FEATURES.GMAIL_INGEST. When
            the flag is off, this whole block is dead code in render
            (preserved for fast re-enable). */}
        {FEATURES.GMAIL_INGEST && activeTab === "emails" && (
          <>
            {/* Sub-session 24 follow-up commit 2: Pro-only upgrade card.
                After the backend Pro-gate (commit 1) non-Pro plans get
                labels:[], so the label-pill row below would render
                empty. Replace the entire Emails-tab workflow with an
                upgrade card for non-Pro users — they get a clear path
                to Pro instead of a confused empty UI. */}
            {clientInfo && clientInfo.plan !== "pro" ? (
              <div className="bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-300 rounded-xl py-8 px-6 text-center">
                <p className="text-4xl mb-3">{"\u{1F4E7}"}</p>
                <h3 className="text-lg font-bold text-amber-900 m-0 mb-2">
                  Gmail auto-fetch is a Pro feature
                </h3>
                <p className="text-sm text-amber-800 m-0 mb-5 max-w-md mx-auto leading-relaxed">
                  Upgrade to Pro ($89/mo) to pull invoices, receipts,
                  and AR follow-ups directly from your Gmail labels — no
                  manual uploads. We extract structured data with AI and
                  categorize each item automatically.
                </p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <Link
                    href="/billing"
                    className="inline-block py-2.5 px-6 rounded-lg bg-amber-600 text-white text-sm font-semibold no-underline cursor-pointer"
                  >
                    View plans
                  </Link>
                  <Link
                    href="/help/gmail-setup"
                    className="text-sm text-amber-800 hover:underline"
                  >
                    Preview the setup guide {"→"}
                  </Link>
                </div>
              </div>
            ) : (
              <>
            {/* Sub-session 24 follow-up commit 5: setup-guide hint for
                Pro users on the Emails tab. Pro users land here AFTER
                completing OAuth — but if their Gmail doesn't have the
                three labels yet, the pills below will return empty
                results with no explanation. The hint link sits right
                under the page title so a confused user has a one-click
                path to the setup guide. Always renders for Pro (low
                visual cost; high diagnostic value for first-runners). */}
            <div className="mb-3 text-xs text-slate-500">
              {"\u{1F4A1}"} Don&apos;t see emails when you click a label?{" "}
              <Link
                href="/help/gmail-setup"
                className="text-blue-600 hover:underline font-medium"
              >
                See the Gmail label setup guide {"\u{2192}"}
              </Link>
            </div>
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
                  {uploading ? "Analyzing..." : "Upload file"}
                  <input
                    type="file"
                    // XLSX added alongside CSV/TSV — see lib/xlsx.ts.
                    // Legacy .xls intentionally excluded (server returns
                    // a "save as .xlsx" message if uploaded anyway).
                    accept=".csv,.tsv,.xlsx"
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

            {/* Event auto-coding selector. Sub-session 33: every
                paying tier gets Events, so this shows for all paying
                tiers. Drives handleUpload's batch eventId (or leaves
                /api/upload to do per-row date matching). */}
            {isPayingTier(clientInfo?.plan) && (
              <div className="mb-5 flex items-center gap-3 flex-wrap">
                <label
                  htmlFor="upload-event-select"
                  className="text-sm text-slate-600"
                >
                  {"\u{1F4C5}"} Auto-code uploaded rows to event:
                </label>
                <select
                  id="upload-event-select"
                  value={selectedEventChoice}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === "create") {
                      setShowInlineEventForm(true);
                      setSelectedEventChoice("create");
                    } else {
                      setShowInlineEventForm(false);
                      setSelectedEventChoice(value);
                    }
                  }}
                  disabled={uploading}
                  className="py-1.5 px-3 rounded-md border border-slate-200 text-sm bg-white text-slate-700 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="auto">Detect by date</option>
                  {availableEvents.map((event) => (
                    <option key={event.id} value={String(event.id)}>
                      {event.name}
                    </option>
                  ))}
                  <option value="create">+ Create new event</option>
                </select>
              </div>
            )}

            {/* Upload tips + template download. Sits below the event
                picker so the framing reads top-down: action → option →
                context. Helps merchants understand WHEN to use upload
                vs. relying on platform integrations (most platform
                sales auto-import via Shopify/Wix/Square/Gmail). */}
            <div className="mb-5 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-[280px]">
                <span className="mr-1">{"\u{1F4A1}"}</span>
                <span className="font-medium text-slate-700">
                  Most platform sales auto-import.
                </span>{" "}
                Use Upload for market-day cash sales, Venmo/Zelle
                transfers, wholesale invoices typed into a spreadsheet,
                or any one-off transaction without a connected source.
                {" "}For market days, pick the event above to batch-tag
                every row.
              </div>
              <a
                href="/templates/flowwork-sales-template.csv"
                download="flowwork-sales-template.csv"
                className="text-blue-600 hover:text-blue-700 hover:underline whitespace-nowrap font-medium"
              >
                {"\u{2B07}\u{FE0F}"} Download CSV template
              </a>
            </div>

            {/* Inline event-create form — appears when "+ Create new event"
                is picked in the selector above. Reuses the standalone form
                from /events; onCreated adds the new event to the local
                list and auto-selects it for this upload. */}
            {showInlineEventForm && (
              <EventCreateForm
                existingEvents={availableEvents}
                onCreated={(newEvent) => {
                  setAvailableEvents((prev) => [newEvent, ...prev]);
                  setSelectedEventChoice(String(newEvent.id));
                  setShowInlineEventForm(false);
                }}
                onCancel={() => {
                  setShowInlineEventForm(false);
                  setSelectedEventChoice("auto");
                }}
              />
            )}

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
          </>
        )}

        {/* ── PROCESSED TAB ── */}
        {activeTab === "processed" && (
          <>
            {/* UX commit 4: status-filter chip. Visible only when a
                filter is active (typically set by clicking a Status
                Breakdown pill on the Dashboard tab). */}
            {processedStatusFilter && (
              <div className="mb-4 flex items-center gap-2 flex-wrap">
                <span className="text-sm text-slate-600">
                  Showing only <strong>{processedStatusFilter.replace("_", " ")}</strong> items
                </span>
                <button
                  type="button"
                  onClick={() => setProcessedStatusFilter(null)}
                  className="text-sm text-blue-600 hover:underline cursor-pointer"
                >
                  Clear filter
                </button>
              </div>
            )}
            {/* Sub-session 32 polish: settled-toggle chip. Visible
                whenever the user has at least one paid row AND no
                status-filter chip is active (the status-filter chip
                takes precedence — clicking the dashboard's "paid"
                pill should still surface paid items). */}
            {processedStatusFilter === null &&
              processedItems.some((i) => i.status === "paid") && (
                <div className="mb-4 flex items-center gap-2 flex-wrap text-sm text-slate-600">
                  {hideSettled ? (
                    <>
                      <span>
                        {processedItems.filter((i) => i.status === "paid").length}{" "}
                        settled {processedItems.filter((i) => i.status === "paid").length === 1 ? "item" : "items"} hidden
                      </span>
                      <button
                        type="button"
                        onClick={() => setHideSettled(false)}
                        className="text-blue-600 hover:underline cursor-pointer"
                      >
                        Show settled {"\u{2192}"}
                      </button>
                    </>
                  ) : (
                    <>
                      <span>Showing settled items.</span>
                      <button
                        type="button"
                        onClick={() => setHideSettled(true)}
                        className="text-blue-600 hover:underline cursor-pointer"
                      >
                        Hide settled
                      </button>
                    </>
                  )}
                </div>
              )}
            {(() => {
              // Apply the status filter immediately above the empty-
              // state branch so "no rows after filter" gets a distinct
              // empty state from "no rows at all."
              //
              // Filter precedence (highest first):
              //   1. processedStatusFilter — set via dashboard pill click
              //   2. hideSettled — default inbox behavior, hides "paid"
              //   3. no filter — show everything
              const visibleItems = processedStatusFilter
                ? processedItems.filter((i) => i.status === processedStatusFilter)
                : hideSettled
                ? processedItems.filter((i) => i.status !== "paid")
                : processedItems;
              return processedItems.length === 0 ? (
              <div className="text-center p-[60px] text-slate-400 text-[15px]">
                <p className="text-5xl mb-2">{"\u{1F4CB}"}</p>
                <p>No processed items yet. Fetch emails and click Process with AI.</p>
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="text-center p-[60px] text-slate-400 text-[15px]">
                <p className="text-5xl mb-2">{"\u{1F50D}"}</p>
                {processedStatusFilter ? (
                  <p>
                    No items match the{" "}
                    <strong>{processedStatusFilter.replace("_", " ")}</strong>{" "}
                    filter.
                  </p>
                ) : (
                  // hideSettled hid everything — every row is paid.
                  // Show a positive "all caught up" message rather than
                  // a generic empty state.
                  <p>
                    All caught up — nothing needs your attention.{" "}
                    <button
                      type="button"
                      onClick={() => setHideSettled(false)}
                      className="text-blue-600 hover:underline cursor-pointer bg-transparent border-0 p-0 text-[15px]"
                    >
                      Show settled items
                    </button>
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
                {visibleItems.map((item) => (
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
                      {/* Phase 13: channel row + reclassify trigger.
                          Click the chip to open the modal and pick a
                          different channel. Empty when the classifier
                          can't derive one (rare). */}
                      <div className="flex justify-between items-center py-1.5 border-b border-slate-50">
                        <span className="text-[13px] text-slate-500">Channel</span>
                        <button
                          type="button"
                          onClick={() =>
                            setReclassifyRow({
                              id: item.id,
                              vendor: item.vendor,
                              amount: item.amount,
                              channel: item.channel,
                            })
                          }
                          title="Reclassify channel"
                          className="text-[13px] font-medium text-blue-600 hover:text-blue-700 hover:underline bg-transparent border-0 cursor-pointer p-0 inline-flex items-center gap-1"
                        >
                          {item.channel ?? "Uncategorized"}
                          <span className="text-[10px]" aria-hidden="true">{"\u{270E}"}</span>
                        </button>
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

                    {/* Status actions. Sub-session 33: each button
                        carries a title tooltip + the row has a small
                        "Set status" label so the four icons aren't a
                        guessing game. */}
                    <div className="pt-2 px-4 pb-3 border-t border-slate-100">
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 m-0 mb-1.5">
                        Set status
                      </p>
                      <div className="flex gap-1">
                        {(["pending", "paid", "overdue", "needs_review"] as const).map((s) => {
                          const isUpdating = updatingStatus.has(item.id);
                          const isActive = item.status === s;
                          const meta = STATUS_BUTTON_META[s];
                          return (
                            <button
                              key={s}
                              onClick={() => updateStatus(item.id, s)}
                              disabled={isUpdating}
                              title={meta.title}
                              aria-label={meta.title}
                              className={`flex-1 px-1 py-1.5 border rounded-md cursor-pointer transition-all duration-150 inline-flex flex-col items-center justify-center gap-0.5 disabled:opacity-60 disabled:cursor-wait ${
                                isActive
                                  ? "bg-slate-100 border-slate-400"
                                  : "bg-white border-slate-200"
                              }`}
                            >
                              {isUpdating && isActive ? (
                                <Spinner size={14} color="#475569" />
                              ) : (
                                <>
                                  <span className="text-base leading-none">{meta.icon}</span>
                                  <span className="text-[9px] text-slate-500 leading-none">
                                    {meta.label}
                                  </span>
                                </>
                              )}
                            </button>
                          );
                        })}
                      </div>
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
            );
            })()}
          </>
        )}

        {/* ── DASHBOARD TAB ── */}
        {activeTab === "dashboard" && (
          <div
            // UX commit 5: pale-yellow tint when ANY sample data is
            // present in the processed-items array. Distinct visual
            // cue that the numbers above shouldn't be trusted as real,
            // without the heavy-handedness of per-card stamps or a
            // diagonal SAMPLE watermark. Tint disappears the moment
            // the user clears sample data.
            className={
              processedItems.some((i) => i.source === "sample")
                ? "relative bg-yellow-50/40 rounded-xl p-4 -m-4"
                : ""
            }
          >
            {processedItems.some((i) => i.source === "sample") && (
              <div className="mb-4 text-xs font-semibold text-amber-800 uppercase tracking-wide flex items-center gap-2">
                <span>{"\u{1F4A1}"}</span>
                <span>Sample data view — numbers below are examples</span>
              </div>
            )}

            {/* Flow-redesign commit 6: SetupChecklist removed from
                dashboard per locked decision #3. Setup lives at
                /onboarding now (single canonical surface). A "Setup
                checklist" link in the top nav routes users there. */}

            {/* Phase 9.2 dashboard pivot per Jacob's "command center"
                redesign. Replaces the prior stat-cards + Status
                Breakdown + AR + ChannelTable + Top Categories layout
                with a focused 3-section structure:
                  1. SalesBanner (3 big numbers: Sales / Expenses / Net)
                  2. 2-column grid: ChannelStack (left) + UpcomingEventsCard (right)
                  3. Empty-state CTA (only when truly no data)
                Removed sections live elsewhere now:
                  - Status Breakdown counts → ActionItemsStrip (below
                    top nav) for the urgent ones (Needs Review,
                    Overdue), demoted to /processed and /invoices
                    pages for browsing
                  - AR card → ActionItemsStrip overdue pill + /invoices
                  - Top Categories → /reports already shows by-category
                    breakdowns
                  - Stat cards (Avg Confidence, Business Miles, Total
                    Items) → removed as low-decision-value vanity metrics */}
            <SalesBanner
              totalSales={channelData?.totalRevenue ?? 0}
              totalExpenses={
                channelData
                  ? channelData.channels.reduce(
                      (sum, c) => sum + c.directExpenses,
                      0
                    ) + channelData.overhead
                  : 0
              }
              netProfit={channelData?.netProfit ?? 0}
              year={channelYear}
              loading={!channelData || !collapsedChannelsLoaded}
            />

            {/* Phase 9.2: AR card removed. Overdue $ now surfaces in
                the ActionItemsStrip below the top nav as a click-
                through pill → /invoices?status=overdue. The full AR
                summary lives on /invoices (already its own page). */}

            {/* Phase 9.2: 2-column grid — ChannelStack (vertical
                channel cards) on the left + UpcomingEventsCard
                (Events + Promotions placeholder) on the right. The
                grid stacks to single-column on mobile (< lg). Both
                cards render with their own loading state, so the
                grid renders eagerly + each card shows skeletons.

                "See full breakdown →" link on the top-right routes
                to /profitability for the full ChannelTable detail
                view (which keeps the year picker + mode toggle). */}
            {/* Period picker + drill-down link row. The picker
                drives BOTH the SalesBanner numbers AND the
                ChannelStack data — they share the same channelData
                fetch (re-runs when channelYear changes). */}
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="dashboard-year"
                  className="text-xs font-medium text-slate-500 uppercase tracking-wide"
                >
                  Period
                </label>
                <select
                  id="dashboard-year"
                  value={channelYear}
                  onChange={(e) => setChannelYear(Number(e.target.value))}
                  className="py-1 px-2 text-xs border border-slate-300 rounded bg-white focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500"
                >
                  {[
                    dashboardCurrentYear,
                    dashboardCurrentYear - 1,
                    dashboardCurrentYear - 2,
                    dashboardCurrentYear - 3,
                  ].map((y) => (
                    <option key={y} value={y}>
                      {y === dashboardCurrentYear ? `${y} (YTD)` : String(y)}
                    </option>
                  ))}
                </select>
              </div>
              <Link
                href="/profitability"
                className="text-xs text-blue-600 hover:underline"
              >
                See full channel breakdown {"\u{2192}"}
              </Link>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
              {/* Left: Channels (vertical) */}
              {channelData && collapsedChannelsLoaded ? (
                <ChannelStack
                  channels={channelData.channels}
                  maxRevenue={Math.max(
                    ...channelData.channels.map((c) => c.revenue),
                    1
                  )}
                  collapsedChannels={collapsedChannels}
                  onToggleCollapse={toggleChannelCollapse}
                  isPro={isPayingTier(clientInfo?.plan)}
                />
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <div className="h-5 w-32 bg-slate-100 rounded animate-pulse mb-4" />
                  <div className="space-y-2">
                    {[0, 1].map((i) => (
                      <div
                        key={i}
                        className="h-16 bg-slate-50 rounded animate-pulse"
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Right: Upcoming Events + Promotions */}
              <UpcomingEventsCard
                events={upcomingEvents}
                loading={availableEvents.length === 0 && !clientInfo}
              />
            </div>

            {/* Phase 12g: COGS gross-margin widget. Pro-gated via the
                /api/cogs/summary 403 (silent hide for non-Pro). Self-
                fetches a 30-day window, surfaces top SKUs +
                underwater + unmatched warnings, links to /cogs for
                the full dashboard. */}
            <CogsSummaryCard />

            {/* Phase 9.2: Top Categories removed from dashboard.
                Same data lives on /reports as the by-category
                breakdown — that's the canonical surface now. */}

            {/* UX commit 9: empty-state CTA card. Replaces the prior
                dead text ("Process some emails to see dashboard data")
                with a 3-path coaching card surfaced exactly when the
                user has cleared sample data and has no real items yet.
                Each path is a one-click route to the relevant ingest
                surface — no hunting through the nav. */}
            {processedItems.length === 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
                <p className="text-5xl mb-3">{"\u{1F4CA}"}</p>
                <h3 className="text-lg font-bold text-slate-900 m-0 mb-2">
                  Add your first transaction
                </h3>
                <p className="text-sm text-slate-500 m-0 mb-6 max-w-md mx-auto">
                  FlowWork starts populating this dashboard the moment
                  you add real data. Pick whichever path fits your
                  workflow.
                </p>
                {/* Sub-session 24 follow-up commit 2: Connect-Gmail
                    path renders only for Pro users (matches the
                    /api/gmail Pro-gate). Non-Pro users see a 2-card
                    grid (Upload + Add manually); Pro users see all 3. */}
                <div
                  className={`grid grid-cols-1 gap-3 max-w-2xl mx-auto ${
                    clientInfo?.plan === "pro" && FEATURES.GMAIL_INGEST
                      ? "sm:grid-cols-3"
                      : "sm:grid-cols-2"
                  }`}
                >
                  {clientInfo?.plan === "pro" && FEATURES.GMAIL_INGEST && (
                    <button
                      type="button"
                      onClick={() => setActiveTab("emails")}
                      className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left cursor-pointer hover:bg-blue-100 transition-colors"
                    >
                      <div className="text-2xl mb-1.5">{"\u{1F4E7}"}</div>
                      <div className="text-sm font-semibold text-slate-900 mb-1">
                        Connect Gmail
                      </div>
                      <div className="text-xs text-slate-500">
                        Auto-pull invoices and expenses from your inbox.
                      </div>
                    </button>
                  )}
                  {/* Sub-session 33: when Gmail is hidden, "Upload a
                      file" CTA wraps a hidden file input directly so
                      clicking it opens the picker (matches the
                      header Upload button pattern). When Gmail is
                      enabled, the original Emails-tab-switch
                      behavior is preserved. */}
                  {FEATURES.GMAIL_INGEST ? (
                    <button
                      type="button"
                      onClick={() => setActiveTab("emails")}
                      className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-left cursor-pointer hover:bg-emerald-100 transition-colors"
                    >
                      <div className="text-2xl mb-1.5">{"\u{1F4C1}"}</div>
                      <div className="text-sm font-semibold text-slate-900 mb-1">
                        Upload a file
                      </div>
                      <div className="text-xs text-slate-500">
                        CSV, TSV, or XLSX export from your accounting tool.
                      </div>
                    </button>
                  ) : (
                    <label
                      className={`bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-left transition-colors block m-0 ${
                        uploading
                          ? "opacity-50 cursor-not-allowed"
                          : "cursor-pointer hover:bg-emerald-100"
                      }`}
                    >
                      <div className="text-2xl mb-1.5">{"\u{1F4C1}"}</div>
                      <div className="text-sm font-semibold text-slate-900 mb-1">
                        {uploading ? "Uploading..." : "Upload a file"}
                      </div>
                      <div className="text-xs text-slate-500">
                        CSV, TSV, or XLSX export from your accounting tool.
                      </div>
                      <input
                        type="file"
                        accept=".csv,.tsv,.xlsx"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUpload(f);
                          e.target.value = "";
                        }}
                        disabled={uploading}
                      />
                    </label>
                  )}
                  <Link
                    href="/invoices/new"
                    className="bg-violet-50 border border-violet-200 rounded-lg p-4 text-left cursor-pointer hover:bg-violet-100 transition-colors no-underline block"
                  >
                    <div className="text-2xl mb-1.5">{"\u{270F}"}</div>
                    <div className="text-sm font-semibold text-slate-900 mb-1">
                      Add manually
                    </div>
                    <div className="text-xs text-slate-500">
                      Create your first invoice by hand.
                    </div>
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Phase 13: per-row channel reclassify modal. Opens from
            the Channel chip on any Processed-tab card. PATCH on
            confirm; explicit channel beats classifier derivation
            so the change sticks. */}
        <ReclassifyModal
          open={reclassifyRow !== null}
          row={reclassifyRow}
          onClose={() => setReclassifyRow(null)}
          onSaved={async () => {
            setReclassifyRow(null);
            await loadItems();
          }}
        />

        {/* ── CSV REVIEW MODAL ── */}
        <CsvReviewModal
          uploadReview={uploadReview}
          reviewRows={reviewRows}
          setReviewRows={setReviewRows}
          events={availableEvents}
          onCancel={() => {
            setUploadReview(null);
            setReviewRows([]);
          }}
          onConfirm={confirmImport}
          importing={importing}
        />

        {/* ── CLEAR SAMPLE DATA CONFIRMATION ── */}
        {/* UX commit 1: replaces the legacy window.confirm() with the
            shared ConfirmModal. Same destructive-op pattern other arcs
            will adopt (Phase 6.5 dismiss-invoice migrates in commit 8
            of this arc). */}
        <ConfirmModal
          open={confirmClearOpen}
          title="Clear all sample data?"
          message="This deletes the example transactions FlowWork seeded for your industry. You can't undo this, but your real data is untouched."
          confirmLabel="Clear sample data"
          danger
          busy={clearingSample}
          onConfirm={confirmClearSample}
          onCancel={() => setConfirmClearOpen(false)}
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
