"use client";

import { useState, useEffect, useCallback, use, useMemo } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "../../components/PageHeader";
import AppHeader from "../../components/AppHeader";
import Spinner from "../../components/Spinner";
import ErrorBanner from "../../components/ErrorBanner";
import { type EventResponse } from "../../components/EventCreateForm";
// Phase 5 commit 4: client-side category source for the manual-expense
// picker. lib/categories.ts is pure data + pure functions (no Node
// imports) so it's safe to use in a client component.
import {
  getCategoriesForIndustry,
  type Industry,
} from "@/lib/categories";

interface EventItem {
  id: number;
  eventId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  createdAt: string;
}

interface LinkedTxn {
  id: number;
  vendor: string;
  amount: number;
  dueDate: string | null;
  category: string | null;
  status: string | null;
}

interface LinkedTransactions {
  count: number;
  totalAmount: number;
  transactions: LinkedTxn[];
}

// Per-event P&L slice from /api/profitability — see app/api/profitability/route.ts.
// The endpoint returns an array of these; we pick the entry matching this event.
interface ProfitabilityPerEvent {
  id: number;
  revenue: { total: number; manual: number; linked: number };
  expenses: { total: number; linked: number; manual: number };
  boothFee: number;
  totalMiles: number | null;
  /** Mileage cost at the OPERATING rate (gas ÷ MPG). Used in the
   *  profit math — honest cash impact of driving. */
  mileageCost: number;
  /** Mileage cost at the IRS standard rate. Surfaced as the
   *  Schedule C deduction value alongside the operating cost. */
  irsMileageCost?: number;
  /** COGS of products sold at this event (FIFO cost stamped on the line
   *  items). Optional for deploy-gap safety with older API responses. */
  cogs?: number;
  grossProfit?: number;
  /** Sold line items not yet costed (unmatched SKU) — flags partial COGS. */
  uncostedLines?: number;
  profit: number;
  unknownAmount: number;
}

// Items in the editor carry strings for the input-control fields so the user
// can type freely (incomplete numbers, "$" prefix, etc.). Parsed on save.
interface ItemDraft {
  productName: string;
  quantity: string;
  unitPrice: string;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

function stripMoneySymbols(v: string): string {
  return v.replace(/[$,\s]/g, "");
}

function parseMoneyOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const num = Number(stripMoneySymbols(v));
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function formatMoney(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Format a transaction's calendar date for the linked drill-down. Parses
// the YYYY-MM-DD prefix into a LOCAL date so we never show the prior day
// from a UTC-midnight ISO string (the known due-date off-by-one trap).
function formatLinkedDate(raw: string | null): string {
  if (!raw) return "No date";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function EventDetailPage({ params }: PageProps) {
  const { id: rawId } = use(params);
  const router = useRouter();

  const [event, setEvent] = useState<EventResponse | null>(null);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [linkedTx, setLinkedTx] = useState<LinkedTransactions | null>(null);
  // Drill-down: reveal the actual transactions behind the linked-revenue
  // total inline, so the user doesn't have to leave for the Transactions page.
  const [showLinkedTxns, setShowLinkedTxns] = useState(false);
  const [totalMiles, setTotalMiles] = useState<number | null>(null);
  // Phase 5 commit 6: per-event P&L breakdown sourced from /api/profitability.
  // null until first fetch or if the endpoint returns no slice for this event.
  // rateSource is the honesty flag — "fallback" means the IRS rate isn't from
  // app_settings (migration 0006 hasn't run or row is missing); we render a
  // visible notice so the breakdown number isn't taken as fully configured.
  const [profitability, setProfitability] = useState<ProfitabilityPerEvent | null>(null);
  const [irsMileageRate, setIrsMileageRate] = useState<number>(0.7);
  const [rateSource, setRateSource] = useState<"config" | "fallback">("fallback");
  // Phase 9.2 follow-up: operating rate (gas ÷ MPG) from
  // preferences.vehicle. Drives the cash-impact mileage cost in the
  // P&L; the IRS-rate value above remains available for the Schedule
  // C deduction line shown alongside.
  const [operatingRate, setOperatingRate] = useState<number>(3.67 / 30);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Phase 4: separate spinner for the Recalculate affordance — doesn't
  // block the full Save button while a one-shot maps lookup runs.
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Phase 5 commit 4: client industry + custom categories for the
  // manual-expense category picker. Fetched in parallel with the event
  // load — see loadEvent below.
  const [clientIndustry, setClientIndustry] = useState<Industry>("other");
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  // Phase 5 follow-up bug fix: home address is needed to disambiguate
  // the Mileage card's empty state. The prior conditional inferred
  // "home address missing" from totalMiles===null + event.address set,
  // which was wrong when round_trip_miles was null due to a maps-API
  // failure rather than a missing address. /api/settings already
  // returns homeAddress; the prior code just discarded it.
  const [clientHomeAddress, setClientHomeAddress] = useState<string | null>(null);

  // Phase 5 commit 4: manual-expense form state.
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("");
  const [expenseVendor, setExpenseVendor] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [expenseError, setExpenseError] = useState<string | null>(null);

  // Form state — separate from loaded event so the user can edit freely.
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [multiDay, setMultiDay] = useState(false);
  const [venue, setVenue] = useState("");
  const [address, setAddress] = useState("");
  const [returnsHomeNightly, setReturnsHomeNightly] = useState(true);
  const [boothFee, setBoothFee] = useState("");
  const [revenue, setRevenue] = useState("");
  const [notes, setNotes] = useState("");

  const populateForm = useCallback(
    (ev: EventResponse, evItems: EventItem[]) => {
      setName(ev.name);
      setStartDate(ev.startDate);
      setEndDate(ev.endDate);
      setMultiDay(ev.startDate !== ev.endDate);
      setVenue(ev.venue ?? "");
      setAddress(ev.address ?? "");
      setReturnsHomeNightly(ev.returnsHomeNightly ?? true);
      setBoothFee(ev.boothFee === 0 ? "" : String(ev.boothFee));
      setRevenue(ev.revenue == null ? "" : String(ev.revenue));
      setNotes(ev.notes ?? "");
      setItems(
        evItems.map((it) => ({
          productName: it.productName,
          quantity: String(it.quantity),
          unitPrice: String(it.unitPrice),
        }))
      );
    },
    []
  );

  const loadEvent = useCallback(async () => {
    // Phase 5 commit 4: fetch event + settings in parallel. Settings
    // gives us the client's industry (for the expense-category picker)
    // and their custom categories. Settings is optional — if it fails
    // we still render the event with reasonable defaults (industry =
    // "other", no custom categories).
    //
    // Phase 5 commit 6: also fetch /api/profitability for the P&L
    // breakdown card. The endpoint returns an array of per-event slices
    // for this client; we pick the entry whose id matches this event.
    // Failure is non-fatal — the P&L card just doesn't render.
    const [eventRes, settingsRes, profRes] = await Promise.all([
      fetch(`/api/events/${encodeURIComponent(rawId)}`),
      fetch("/api/settings"),
      fetch("/api/profitability"),
    ]);

    if (eventRes.status === 401) {
      router.replace(`/signin?callbackUrl=/events/${encodeURIComponent(rawId)}`);
      return;
    }
    if (eventRes.status === 403) {
      // Starter — redirect to /events where the upgrade prompt lives.
      router.replace("/events");
      return;
    }
    if (eventRes.status === 404) {
      setError("Event not found.");
      setLoading(false);
      return;
    }
    if (!eventRes.ok) {
      setError(`Couldn't load event: HTTP ${eventRes.status}`);
      setLoading(false);
      return;
    }
    const data = (await eventRes.json()) as {
      event: EventResponse;
      items: EventItem[];
      linkedTransactions: LinkedTransactions;
      totalMiles?: number | null;
    };
    setEvent(data.event);
    setLinkedTx(data.linkedTransactions);
    setTotalMiles(data.totalMiles ?? null);
    populateForm(data.event, data.items);

    if (settingsRes.ok) {
      const sData = (await settingsRes.json()) as {
        industry?: string;
        settings?: { custom_categories?: unknown };
        homeAddress?: string | null;
      };
      if (typeof sData.industry === "string") {
        setClientIndustry(sData.industry as Industry);
      }
      const custom = sData.settings?.custom_categories;
      if (Array.isArray(custom)) {
        setCustomCategories(
          custom.filter((c): c is string => typeof c === "string")
        );
      }
      // homeAddress can come back as null when the user hasn't set one.
      // Trim + empty-string → null so downstream truthy checks behave.
      const rawHome = sData.homeAddress;
      const home =
        typeof rawHome === "string" && rawHome.trim().length > 0
          ? rawHome.trim()
          : null;
      setClientHomeAddress(home);
    }

    // Find this event's slice in the profitability response.
    if (profRes.ok) {
      const pData = (await profRes.json()) as {
        perEvent?: ProfitabilityPerEvent[];
        irsMileageRate?: number;
        rateSource?: "config" | "fallback";
        operatingRate?: number;
      };
      const eventIdNum = Number(rawId);
      const slice = pData.perEvent?.find((e) => e.id === eventIdNum) ?? null;
      setProfitability(slice);
      if (typeof pData.irsMileageRate === "number") {
        setIrsMileageRate(pData.irsMileageRate);
      }
      if (pData.rateSource === "config" || pData.rateSource === "fallback") {
        setRateSource(pData.rateSource);
      }
      if (typeof pData.operatingRate === "number" && pData.operatingRate > 0) {
        setOperatingRate(pData.operatingRate);
      }
    }
    setLoading(false);
  }, [rawId, router, populateForm]);

  useEffect(() => {
    loadEvent().catch((err) => {
      setError(err instanceof Error ? err.message : "Couldn't load event");
      setLoading(false);
    });
  }, [loadEvent]);

  const itemsGrandTotal = items.reduce((sum, it) => {
    const qty = Number(it.quantity) || 0;
    const price = parseMoneyOrNull(it.unitPrice) ?? 0;
    return sum + qty * price;
  }, 0);

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { productName: "", quantity: "1", unitPrice: "0" },
    ]);
  };

  const handleRemoveItem = (i: number) => {
    setItems((prev) => prev.filter((_, j) => j !== i));
  };

  const handleUpdateItem = (
    i: number,
    field: keyof ItemDraft,
    value: string
  ) => {
    setItems((prev) =>
      prev.map((it, j) => (j === i ? { ...it, [field]: value } : it))
    );
  };

  const handleSave = async () => {
    setError(null);
    setSuccessMsg(null);

    if (name.trim() === "") {
      setError("Name is required.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      setError("Start date is required.");
      return;
    }
    const effectiveEnd = multiDay ? endDate : startDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveEnd)) {
      setError("End date is invalid.");
      return;
    }
    if (multiDay && effectiveEnd < startDate) {
      setError("End date must be on or after the start date.");
      return;
    }

    const boothFeeNum = parseMoneyOrNull(boothFee);
    if (boothFee.trim() !== "" && boothFeeNum === null) {
      setError("Booth fee must be a non-negative number.");
      return;
    }
    const revenueNum = parseMoneyOrNull(revenue);
    if (revenue.trim() !== "" && revenueNum === null) {
      setError("Revenue must be a non-negative number.");
      return;
    }

    // Item validation: drop empty-product-name rows; validate remaining.
    const itemsPayload: {
      productName: string;
      quantity: number;
      unitPrice: number;
    }[] = [];
    for (const [idx, it] of items.entries()) {
      if (it.productName.trim() === "") continue;
      const qty = Number(it.quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        setError(`Line ${idx + 1}: quantity must be a positive integer.`);
        return;
      }
      const price = parseMoneyOrNull(it.unitPrice);
      if (price === null && it.unitPrice.trim() !== "") {
        setError(`Line ${idx + 1}: unit price must be a non-negative number.`);
        return;
      }
      itemsPayload.push({
        productName: it.productName.trim(),
        quantity: qty,
        unitPrice: price ?? 0,
      });
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(rawId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          startDate,
          endDate: effectiveEnd,
          venue: venue.trim() === "" ? null : venue.trim(),
          address: address.trim() === "" ? null : address.trim(),
          // returnsHomeNightly only meaningful for multi-day events.
          // For single-day events, send DB-default true to match the
          // EventCreateForm convention from commit 4.
          returnsHomeNightly: multiDay ? returnsHomeNightly : true,
          boothFee: boothFeeNum ?? 0,
          revenue: revenueNum,
          notes: notes.trim() === "" ? null : notes.trim(),
          items: itemsPayload,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg =
          (data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : null) ?? `Couldn't save event (HTTP ${res.status})`;
        setError(msg);
        return;
      }
      const data = (await res.json()) as {
        event: EventResponse;
        items: EventItem[];
      };
      setEvent(data.event);
      populateForm(data.event, data.items);
      // Re-fetch linkedTransactions — could have changed if items were edited
      // alongside (it doesn't actually change with items, but a future
      // user-correction flow could touch it). Cheaper to re-fetch the full
      // page than to track partials.
      await loadEvent();
      setSuccessMsg("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save event");
    } finally {
      setSaving(false);
    }
  };

  // Phase 5 commit 4: expense-category source for the picker. Filters
  // lib/categories.ts to expense-type entries (universal + industry
  // overlay), then appends the client's custom categories (assumed
  // expense per design §3). Deduplicated.
  const allowedExpenseCategories = useMemo(() => {
    const lib = getCategoriesForIndustry(clientIndustry)
      .filter((c) => c.type === "expense")
      .map((c) => c.name);
    const merged = Array.from(new Set([...lib, ...customCategories]));
    return merged.sort((a, b) => a.localeCompare(b));
  }, [clientIndustry, customCategories]);

  // Phase 5 commit 4: open the form, prefill date to the event's start
  // date (matches the API default but the visible field reads better).
  const handleOpenExpenseForm = () => {
    setExpenseAmount("");
    setExpenseCategory(allowedExpenseCategories[0] ?? "");
    setExpenseVendor("");
    setExpenseDate(event?.startDate ?? "");
    setExpenseDescription("");
    setExpenseError(null);
    setShowExpenseForm(true);
  };

  const handleCloseExpenseForm = () => {
    setShowExpenseForm(false);
    setExpenseError(null);
  };

  const handleSubmitExpense = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setExpenseError(null);

    // Parse + validate inline so the user gets specific feedback before
    // we round-trip. The API re-validates everything.
    const cleaned = expenseAmount.replace(/[$,\s]/g, "");
    const amountNum = Number(cleaned);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setExpenseError("Amount must be a positive number.");
      return;
    }
    if (expenseCategory.trim() === "") {
      setExpenseError("Pick a category.");
      return;
    }

    setExpenseSaving(true);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(rawId)}/expenses`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: amountNum,
            category: expenseCategory,
            vendor:
              expenseVendor.trim() === "" ? undefined : expenseVendor.trim(),
            description:
              expenseDescription.trim() === ""
                ? undefined
                : expenseDescription.trim(),
            date: expenseDate || undefined,
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg =
          (data &&
          typeof data === "object" &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : null) ?? `Couldn't add expense (HTTP ${res.status})`;
        setExpenseError(msg);
        return;
      }
      // Re-fetch the event so totals refresh. The P&L breakdown card
      // (commit 6) will reflect the new total automatically.
      await loadEvent();
      setShowExpenseForm(false);
      setSuccessMsg("Expense added.");
    } catch (err) {
      setExpenseError(
        err instanceof Error ? err.message : "Couldn't add expense"
      );
    } finally {
      setExpenseSaving(false);
    }
  };

  // Phase 4: Recalculate mileage affordance. PATCHes with the event's
  // current address — the API's "address presence triggers recompute"
  // rule fires even though the address hasn't changed, giving us a
  // safety-net retry path for transient maps API failures or a
  // corrected home address. Doesn't fail-loud — null result just means
  // no maps API hit landed; the page re-fetches and shows updated state.
  const handleRecalculate = async () => {
    if (!event) return;
    setRecalculating(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(rawId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: event.address ?? null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg =
          (data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : null) ?? `Couldn't recalculate (HTTP ${res.status})`;
        setError(msg);
        return;
      }
      // Refresh the page state so totalMiles + roundTripMiles +
      // mileageComputedAt show the new values.
      await loadEvent();
      setSuccessMsg("Mileage recalculated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't recalculate");
    } finally {
      setRecalculating(false);
    }
  };

  const handleCancel = () => {
    if (event) {
      // Reset to last-loaded values. Items aren't tracked separately on
      // the event object so re-fetch is the simplest correct reset.
      loadEvent().catch(() => {
        // ignore — loadEvent sets its own error state
      });
      setError(null);
      setSuccessMsg(null);
    }
  };

  const handleDelete = async () => {
    if (!event) return;
    const confirmed = confirm(
      `Delete "${event.name}"? Linked transactions will become unlinked but their data is preserved.`
    );
    if (!confirmed) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(rawId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg =
          (data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : null) ?? `Couldn't delete event (HTTP ${res.status})`;
        setError(msg);
        setDeleting(false);
        return;
      }
      router.push("/events");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete event");
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <AppHeader />
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">Loading event...</p>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <AppHeader />
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/events"
            backLabel="Events"
            title="Event not found"
          />
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        </div>
      </div>
    );
  }

  const labelClasses = "block text-sm font-medium text-slate-700 mb-1";
  const inputClasses =
    "w-full py-2.5 px-3.5 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500";
  const itemInputClasses =
    "w-full py-1.5 px-2.5 text-sm border border-slate-200 rounded outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500";

  // Phase 3 §8.1: three revenue sources displayed alongside, NOT merged.
  // Linked-uploads total is the headline; manual revenue and items sum are
  // shown for context. Phase 5 will decide the canonical roll-up.
  const itemsSum = itemsGrandTotal;
  const manualRevenue = event.revenue ?? 0;
  const linkedTotal = linkedTx?.totalAmount ?? 0;
  const linkedCount = linkedTx?.count ?? 0;

  // Phase 5 follow-up bug fix #2: P&L card always renders. When
  // /api/profitability is dark (failing, slow, or returned no slice for
  // this event), derive a local-shaped estimate from the event fields
  // we already have on the page — no silent fallthrough to outdated
  // copy. Treats linked transactions as revenue in the local case,
  // matching the prior "Sales from linked uploads" card's assumed-
  // income behavior; classifying income-vs-expense requires the API's
  // industry-aware splitter. Local-mode net profit therefore doesn't
  // subtract any linked expenses (we can't see them yet); the
  // "showing local estimate" notice surfaces the limitation honestly.
  const pnlSource: "api" | "local" = profitability ? "api" : "local";
  // Local-mode mileage costs at BOTH rates. mileageCost (operating)
  // drives the profit math; irsMileageCost surfaces as the Schedule
  // C deduction value alongside.
  const localMileageCost =
    totalMiles !== null ? totalMiles * operatingRate : 0;
  const localIrsMileageCost =
    totalMiles !== null ? totalMiles * irsMileageRate : 0;
  const pnl = profitability ?? {
    revenue: {
      total: manualRevenue + linkedTotal,
      manual: manualRevenue,
      linked: linkedTotal,
    },
    expenses: { total: 0, linked: 0, manual: 0 },
    boothFee: event.boothFee,
    totalMiles,
    mileageCost: localMileageCost,
    irsMileageCost: localIrsMileageCost,
    // Local mode can't compute COGS (no line-item access here) — leave it
    // 0 and let the "local estimate" notice flag the limitation.
    cogs: 0,
    grossProfit: manualRevenue + linkedTotal,
    uncostedLines: 0,
    profit:
      manualRevenue + linkedTotal - event.boothFee - localMileageCost,
    unknownAmount: 0,
  };
  // Schedule C deduction value — for the side-by-side display in
  // the Mileage row. Falls back to local computation when API
  // didn't return irsMileageCost (e.g., older clients during
  // deploy gap).
  const scheduleCDeduction =
    pnl.irsMileageCost !== undefined
      ? pnl.irsMileageCost
      : pnl.totalMiles !== null
        ? pnl.totalMiles * irsMileageRate
        : 0;

  // COGS of products sold at this market + gross margin (revenue − COGS).
  const eventCogs = pnl.cogs ?? 0;
  const eventUncosted = pnl.uncostedLines ?? 0;
  const grossMargin =
    pnl.revenue.total > 0
      ? ((pnl.revenue.total - eventCogs) / pnl.revenue.total) * 100
      : null;

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <AppHeader />
      <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/events"
          backLabel="Events"
          title={event.name}
          subtitle="View and edit this event"
        />

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        {successMsg && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-4 text-sm">
            {successMsg}
          </div>
        )}

        {/* Phase 5 commit 6 + follow-up: Profit & loss breakdown — the
            headline card. Always renders. When /api/profitability is
            dark, the `pnl` derivation falls back to a local estimate
            built from event.revenue (manual), linkedTx, event.boothFee,
            and totalMiles — the page already has all of these from
            /api/events/[id]. The notice below tells the user when the
            shown breakdown is the local estimate vs. the enriched
            API-classified version. No silent fallthrough to outdated
            copy: same shape, less enriched. */}
        <div className="bg-white rounded-xl border border-slate-200 py-5 px-6 mb-6">
          <p className="text-xs text-slate-500 uppercase tracking-wider m-0 mb-2">
            Net profit
          </p>
          <p
            className={`text-3xl font-bold m-0 mb-4 ${
              pnl.profit >= 0 ? "text-slate-900" : "text-red-700"
            }`}
          >
            {pnl.profit < 0 ? "−" : ""}${formatMoney(Math.abs(pnl.profit))}
          </p>

          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">
                Revenue
                <span className="text-xs text-slate-400 ml-2">
                  {linkedCount > 0 && pnl.revenue.linked > 0 && (
                    <>
                      ${formatMoney(pnl.revenue.linked)} from {linkedCount}{" "}
                      {linkedCount === 1 ? "linked txn" : "linked txns"}
                    </>
                  )}
                  {pnl.revenue.manual > 0 && (
                    <>
                      {linkedCount > 0 && pnl.revenue.linked > 0 ? " + " : ""}
                      ${formatMoney(pnl.revenue.manual)} manual
                    </>
                  )}
                </span>
              </dt>
              <dd className="font-semibold text-slate-900 whitespace-nowrap">
                +${formatMoney(pnl.revenue.total)}
              </dd>
            </div>

            {(eventCogs > 0 || eventUncosted > 0) && (
              <>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-600">
                    COGS
                    {eventUncosted > 0 && (
                      <span className="text-xs text-amber-600 ml-2">
                        {eventUncosted} item{eventUncosted === 1 ? "" : "s"} not
                        costed yet
                      </span>
                    )}
                  </dt>
                  <dd className="font-semibold text-slate-900 whitespace-nowrap">
                    −${formatMoney(eventCogs)}
                  </dd>
                </div>
                {grossMargin !== null && (
                  <div className="flex justify-between gap-3 text-xs text-slate-400">
                    <dt>Gross margin</dt>
                    <dd className="whitespace-nowrap">{grossMargin.toFixed(0)}%</dd>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Booth fee</dt>
              <dd className="font-semibold text-slate-900 whitespace-nowrap">
                −${formatMoney(pnl.boothFee)}
              </dd>
            </div>

            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">
                Expenses
                {pnlSource === "api" && (
                  <span className="text-xs text-slate-400 ml-2">
                    {pnl.expenses.linked > 0 && (
                      <>${formatMoney(pnl.expenses.linked)} linked</>
                    )}
                    {pnl.expenses.linked > 0 && pnl.expenses.manual > 0 && " + "}
                    {pnl.expenses.manual > 0 && (
                      <>${formatMoney(pnl.expenses.manual)} manual</>
                    )}
                  </span>
                )}
                {pnlSource === "local" && (
                  <span className="text-xs text-slate-400 ml-2">
                    not classified yet
                  </span>
                )}
              </dt>
              <dd className="font-semibold text-slate-900 whitespace-nowrap">
                −${formatMoney(pnl.expenses.total)}
              </dd>
            </div>

            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">
                Mileage cost (gas)
                {pnl.totalMiles !== null && (
                  <span className="text-xs text-slate-400 ml-2">
                    {pnl.totalMiles.toLocaleString("en-US", {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}{" "}
                    mi × ${operatingRate.toFixed(2)}/mi
                  </span>
                )}
              </dt>
              <dd className="font-semibold text-slate-900 whitespace-nowrap">
                −${formatMoney(pnl.mileageCost)}
              </dd>
            </div>
          </dl>

          {/* Drill-down into the linked transactions. The revenue row above
              says "$X from N linked txns" but the breakdown alone can't show
              WHICH sales — this expandable list does, inline, so the user
              never has to bounce to the Transactions page just to see what
              an event's revenue is made of. Read-only: edits still happen on
              the Transactions page. */}
          {linkedTx && linkedTx.transactions.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowLinkedTxns((s) => !s)}
                aria-expanded={showLinkedTxns}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-transform ${showLinkedTxns ? "rotate-90" : ""}`}
                  aria-hidden="true"
                >
                  <polyline points="9 6 15 12 9 18" />
                </svg>
                {showLinkedTxns ? "Hide" : "View"} {linkedTx.transactions.length}{" "}
                linked {linkedTx.transactions.length === 1 ? "transaction" : "transactions"}
              </button>
              {showLinkedTxns && (
                <ul className="mt-2 border border-slate-100 rounded-lg divide-y divide-slate-100 overflow-hidden list-none p-0 m-0">
                  {linkedTx.transactions.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate m-0">
                          {t.vendor}
                        </p>
                        <p className="text-xs text-slate-400 m-0">
                          {formatLinkedDate(t.dueDate)}
                          {t.category ? ` · ${t.category}` : ""}
                        </p>
                      </div>
                      <span
                        className={`text-sm font-semibold tabular-nums whitespace-nowrap ${
                          t.amount < 0 ? "text-red-700" : "text-slate-900"
                        }`}
                      >
                        {t.amount < 0 ? "−" : ""}${formatMoney(Math.abs(t.amount))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Schedule C deduction value at IRS rate. Surfaced
              alongside the operating cost above so the user sees
              BOTH numbers: what the drive actually cost (gas) +
              what they can deduct on their tax return (IRS rate).
              The two serve different purposes — the IRS rate
              includes depreciation + maintenance + insurance +
              gas; gas-only is just the cash impact. */}
          {pnl.totalMiles !== null && pnl.totalMiles > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-baseline justify-between gap-3 text-xs">
              <span className="text-slate-500">
                {"\u{1F4CB}"} Schedule C mileage deduction
                <span className="text-slate-400 ml-2">
                  ({pnl.totalMiles.toLocaleString("en-US", {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}{" "}
                  mi × ${irsMileageRate.toFixed(2)}/mi IRS rate)
                </span>
              </span>
              <span className="font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                ${formatMoney(scheduleCDeduction)}
              </span>
            </div>
          )}

          {/* Local-mode notice: the breakdown isn't enriched. The user
              gets honest numbers but without the income/expense split
              on linked transactions or the unknown-amount surfacing. */}
          {pnlSource === "local" && (
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 px-3 py-2 rounded mt-3 m-0">
              {"\u{2139}\u{FE0F}"} Showing local estimate. Linked transactions
              count as revenue here; the enriched breakdown (with
              income/expense classification) loads from /api/profitability.
              If this notice persists, the dashboard endpoint may be
              unreachable.
            </p>
          )}
          {/* Sub-session 19 user feedback: never let a fabricated default
              value pass as configured. rateSource flag from the API
              lights up this notice when the IRS rate isn't from
              app_settings. Only shows in API mode — in local mode we
              don't have a real rate source to compare against. */}
          {pnlSource === "api" && rateSource === "fallback" && scheduleCDeduction > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 rounded mt-3 m-0">
              Schedule C deduction is using the default IRS rate (${irsMileageRate.toFixed(2)}/mi).
              Configure it in{" "}
              <a href="/settings" className="underline">
                Settings
              </a>
              {" "}so your annual report uses the current published rate.
            </p>
          )}
          {pnlSource === "api" && pnl.unknownAmount !== 0 && (
            <p className="text-xs text-slate-500 mt-3 m-0">
              ${formatMoney(Math.abs(pnl.unknownAmount))} in uncategorized
              transactions are excluded from this total. Set a category on each one to
              include them.
            </p>
          )}
          {/* Items sum surfaces the line-item total when present, since
              it's not folded into revenue (line items are a sales-log
              tool, not a separate revenue source). Mirrors the prior
              card's secondary line. */}
          {itemsSum > 0 && (
            <p className="text-xs text-slate-500 mt-3 m-0">
              Line-item total: <span className="font-semibold text-slate-700">${formatMoney(itemsSum)}</span> across {items.length} {items.length === 1 ? "item" : "items"}.
            </p>
          )}
        </div>

        {/* Phase 4: Mileage card. Shows total miles for this event (the
            §8.2 conditional product computed by the API), the single
            round-trip distance, when it was computed, and a Recalculate
            affordance.

            Empty-state branching (Phase 5 follow-up fix): the prior
            conditional inferred "home address missing" from
            totalMiles===null + event.address set, which lied when
            round_trip_miles was null due to a maps-API failure rather
            than a missing field. Now three real cases:

              1. !event.address                  → "Add an address below"
              2. !clientHomeAddress              → "Add home address in Settings"
              3. both set + miles still null     → maps API failed; offer
                                                   Recalculate as retry

            Recalculate is visible in case 3 as the explicit diagnostic
            for "is the maps API the real problem". Previously it only
            rendered when miles already existed, which meant zero way
            to retry from the failure state. */}
        <div className="bg-white rounded-xl border border-slate-200 py-5 px-6 mb-6">
          <div className="flex justify-between items-start gap-3 mb-3 flex-wrap">
            <h2 className="text-lg font-bold text-slate-900 m-0">Mileage</h2>
            {/* Show Recalculate whenever both addresses are set — i.e.,
                whenever a retry could meaningfully succeed. Includes the
                miles-already-exist case AND the failure-state case. */}
            {event.address && clientHomeAddress && (
              <button
                type="button"
                onClick={handleRecalculate}
                disabled={recalculating || saving || deleting}
                className="py-1.5 px-3 rounded-md border border-slate-200 bg-white text-slate-700 text-xs font-medium cursor-pointer inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait"
              >
                {recalculating && <Spinner size={12} />}
                {recalculating ? "Recalculating..." : "Recalculate"}
              </button>
            )}
          </div>

          {totalMiles !== null ? (
            <>
              <p className="text-3xl font-bold text-slate-900 m-0 mb-1">
                {totalMiles.toLocaleString("en-US", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}{" "}
                mi
              </p>
              <p className="text-sm text-slate-500 m-0">
                Total business miles for this event
                {multiDay && event.returnsHomeNightly
                  ? ` (${event.roundTripMiles?.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi round trip × ${Math.round((new Date(`${event.endDate}T00:00:00Z`).getTime() - new Date(`${event.startDate}T00:00:00Z`).getTime()) / 86400000) + 1} days)`
                  : ""}
                {multiDay && !event.returnsHomeNightly
                  ? " (one round trip — stayed near the venue)"
                  : ""}
              </p>
              {event.mileageComputedAt && (
                <p className="text-xs text-slate-400 mt-2 m-0">
                  Last computed{" "}
                  {new Date(event.mileageComputedAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </>
          ) : !event.address ? (
            <p className="text-sm text-slate-500 m-0">
              Add an address below to calculate driving mileage for this event.
            </p>
          ) : !clientHomeAddress ? (
            <p className="text-sm text-slate-500 m-0">
              {"\u{1F697}"} Add your home address in{" "}
              <a href="/settings" className="text-blue-600 no-underline">
                Settings
              </a>{" "}
              to see mileage for this event.
            </p>
          ) : (
            <p className="text-sm text-slate-500 m-0">
              {"\u{26A0}\u{FE0F}"} Mileage couldn&apos;t be computed for this
              event. Click <strong>Recalculate</strong> above to try again — if
              it keeps failing, the Google Maps API may be unconfigured or one
              of the addresses didn&apos;t geocode.
            </p>
          )}
        </div>

        {/* Event details — always-editable form */}
        <div className="bg-white rounded-xl border border-slate-200 py-5 px-6 mb-6">
          <h2 className="text-lg font-bold text-slate-900 mb-4 m-0">Details</h2>

          <div className="mb-4">
            <label htmlFor="ev-name" className={labelClasses}>
              Name<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              id="ev-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={inputClasses}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="ev-start-date" className={labelClasses}>
                {multiDay ? "Start date" : "Date"}
                <span className="text-red-500 ml-0.5">*</span>
              </label>
              <input
                id="ev-start-date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (!multiDay) setEndDate(e.target.value);
                  else if (endDate < e.target.value) setEndDate(e.target.value);
                }}
                required
                className={inputClasses}
              />
            </div>
            {multiDay && (
              <div>
                <label htmlFor="ev-end-date" className={labelClasses}>
                  End date<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input
                  id="ev-end-date"
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                  className={inputClasses}
                />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              const next = !multiDay;
              setMultiDay(next);
              if (!next) setEndDate(startDate);
            }}
            className="text-sm text-blue-600 bg-transparent border-0 p-0 cursor-pointer mb-4"
          >
            {multiDay ? "Single-day event" : "+ Multi-day event"}
          </button>

          {/* Phase 4: "drove home each night" toggle — same UX as
              EventCreateForm (commit 4). Only meaningful for multi-day
              events. Changing it triggers no maps API call; just
              re-derives totalMiles via the §8.2 conditional. */}
          {multiDay && (
            <div className="mb-4">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={returnsHomeNightly}
                  onChange={(e) => setReturnsHomeNightly(e.target.checked)}
                  className="w-4 h-4 cursor-pointer"
                />
                <span>Drove home each night (vs. staying near the venue)</span>
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 mb-4">
            <div>
              <label htmlFor="ev-venue" className={labelClasses}>
                Venue
              </label>
              <input
                id="ev-venue"
                type="text"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="Indianapolis Fairgrounds"
                className={inputClasses}
              />
            </div>
            {/* Phase 4: event street address. Saving with a new value
                triggers a maps API call via PATCH's address-presence
                rule (commit 3). */}
            <div>
              <label htmlFor="ev-address" className={labelClasses}>
                Address
              </label>
              <input
                id="ev-address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St, Indianapolis, IN"
                className={inputClasses}
              />
              <p className="text-xs text-slate-500 m-0 mt-1">
                Used to calculate your mileage.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="ev-booth-fee" className={labelClasses}>
                  Booth fee
                </label>
                <input
                  id="ev-booth-fee"
                  type="text"
                  inputMode="decimal"
                  value={boothFee}
                  onChange={(e) => setBoothFee(e.target.value)}
                  placeholder="$0"
                  className={inputClasses}
                />
              </div>
              <div>
                <label htmlFor="ev-revenue" className={labelClasses}>
                  Cash / other income (not from import)
                </label>
                <input
                  id="ev-revenue"
                  type="text"
                  inputMode="decimal"
                  value={revenue}
                  onChange={(e) => setRevenue(e.target.value)}
                  placeholder="$0"
                  className={inputClasses}
                />
                <p className="text-xs text-slate-500 m-0 mt-1">
                  Income you received that isn&apos;t already in your imported data — added to import totals, not a replacement.
                </p>
              </div>
            </div>
            <div>
              <label htmlFor="ev-notes" className={labelClasses}>
                Notes
              </label>
              <textarea
                id="ev-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Any details about the event..."
                className={`${inputClasses} resize-y`}
              />
            </div>
          </div>
        </div>

        {/* Product sales log — line-item editor */}
        <div className="bg-white rounded-xl border border-slate-200 py-5 px-6 mb-6">
          <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
            <h2 className="text-lg font-bold text-slate-900 m-0">Product sales log</h2>
            <p className="text-sm text-slate-500 m-0">
              Total: <span className="font-semibold text-slate-700">${formatMoney(itemsSum)}</span>
            </p>
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-slate-500 mb-3 m-0">
              No line items yet. Click <strong>+ Add item</strong> below to log per-product sales.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="py-2 px-2 text-left border-b border-slate-200 text-slate-500 font-medium">
                      Product
                    </th>
                    <th className="py-2 px-2 text-right border-b border-slate-200 text-slate-500 font-medium w-20">
                      Qty
                    </th>
                    <th className="py-2 px-2 text-right border-b border-slate-200 text-slate-500 font-medium w-28">
                      Unit price
                    </th>
                    <th className="py-2 px-2 text-right border-b border-slate-200 text-slate-500 font-medium w-24">
                      Total
                    </th>
                    <th className="py-2 px-2 border-b border-slate-200 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => {
                    const qty = Number(item.quantity) || 0;
                    const price = parseMoneyOrNull(item.unitPrice) ?? 0;
                    return (
                      <tr key={i}>
                        <td className="py-2 px-2 border-b border-slate-100">
                          <input
                            type="text"
                            value={item.productName}
                            onChange={(e) =>
                              handleUpdateItem(i, "productName", e.target.value)
                            }
                            placeholder="Hand-thrown mug"
                            className={itemInputClasses}
                          />
                        </td>
                        <td className="py-2 px-2 border-b border-slate-100">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={item.quantity}
                            onChange={(e) =>
                              handleUpdateItem(i, "quantity", e.target.value)
                            }
                            className={`${itemInputClasses} text-right`}
                          />
                        </td>
                        <td className="py-2 px-2 border-b border-slate-100">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={item.unitPrice}
                            onChange={(e) =>
                              handleUpdateItem(i, "unitPrice", e.target.value)
                            }
                            className={`${itemInputClasses} text-right`}
                          />
                        </td>
                        <td className="py-2 px-2 border-b border-slate-100 text-right font-semibold text-slate-700">
                          ${formatMoney(qty * price)}
                        </td>
                        <td className="py-2 px-2 border-b border-slate-100 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(i)}
                            title="Remove line"
                            className="bg-transparent border-0 cursor-pointer text-slate-400 text-base p-0"
                          >
                            {"✕"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            onClick={handleAddItem}
            className="mt-3 py-2 px-4 rounded-md border border-slate-200 bg-white text-slate-700 text-sm font-medium cursor-pointer"
          >
            + Add item
          </button>
        </div>

        {/* Phase 5 commit 4: manual per-event expense. Cash expenses
            (table fee paid in cash, supplies bought en route) that
            aren't in the imported data. Reuses processed_items with
            source='manual' via /api/events/[id]/expenses POST. */}
        <div className="bg-white rounded-xl border border-slate-200 py-5 px-6 mb-6">
          <div className="flex justify-between items-center mb-3 flex-wrap gap-3">
            <h2 className="text-lg font-bold text-slate-900 m-0">Manual expenses</h2>
            {!showExpenseForm && (
              <button
                type="button"
                onClick={handleOpenExpenseForm}
                className="py-2 px-4 rounded-md border border-slate-200 bg-white text-slate-700 text-sm font-medium cursor-pointer"
              >
                + Add expense
              </button>
            )}
          </div>

          {!showExpenseForm ? (
            <p className="text-sm text-slate-500 m-0">
              Add cash expenses (booth fee paid in cash, supplies bought en route)
              that aren&apos;t in your imported data.
            </p>
          ) : (
            <form onSubmit={handleSubmitExpense}>
              {expenseError && (
                <div className="bg-red-50 border border-red-200 text-red-800 px-3.5 py-2.5 rounded-lg mb-4 text-sm">
                  {expenseError}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label htmlFor="exp-amount" className={labelClasses}>
                    Amount<span className="text-red-500 ml-0.5">*</span>
                  </label>
                  <input
                    id="exp-amount"
                    type="text"
                    inputMode="decimal"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                    placeholder="$40"
                    autoFocus
                    required
                    className={inputClasses}
                  />
                </div>
                <div>
                  <label htmlFor="exp-category" className={labelClasses}>
                    Category<span className="text-red-500 ml-0.5">*</span>
                  </label>
                  <select
                    id="exp-category"
                    value={expenseCategory}
                    onChange={(e) => setExpenseCategory(e.target.value)}
                    required
                    className={inputClasses}
                  >
                    {allowedExpenseCategories.length === 0 && (
                      <option value="">No categories yet</option>
                    )}
                    {allowedExpenseCategories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label htmlFor="exp-vendor" className={labelClasses}>
                    Vendor (optional)
                  </label>
                  <input
                    id="exp-vendor"
                    type="text"
                    value={expenseVendor}
                    onChange={(e) => setExpenseVendor(e.target.value)}
                    placeholder="Where you paid"
                    className={inputClasses}
                  />
                </div>
                <div>
                  <label htmlFor="exp-date" className={labelClasses}>
                    Date
                  </label>
                  <input
                    id="exp-date"
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className={inputClasses}
                  />
                </div>
              </div>
              <div className="mb-4">
                <label htmlFor="exp-description" className={labelClasses}>
                  Description (optional)
                </label>
                <input
                  id="exp-description"
                  type="text"
                  value={expenseDescription}
                  onChange={(e) => setExpenseDescription(e.target.value)}
                  placeholder="What was this for?"
                  className={inputClasses}
                />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="submit"
                  disabled={expenseSaving}
                  className="py-2.5 px-6 rounded-lg border-0 bg-blue-500 text-white text-sm font-semibold cursor-pointer inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait"
                >
                  {expenseSaving && <Spinner size={14} color="white" />}
                  {expenseSaving ? "Adding..." : "Add expense"}
                </button>
                <button
                  type="button"
                  onClick={handleCloseExpenseForm}
                  disabled={expenseSaving}
                  className="py-2.5 px-5 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Save / Cancel / Delete */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || deleting}
            className="py-2.5 px-6 rounded-lg border-0 bg-blue-500 text-white cursor-pointer text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait"
          >
            {saving && <Spinner size={14} color="white" />}
            {saving ? "Saving..." : "Save changes"}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={saving || deleting}
            className="py-2.5 px-5 rounded-lg border border-slate-200 bg-white cursor-pointer text-sm text-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <div className="ml-auto">
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving || deleting}
              className="py-2.5 px-5 rounded-lg border border-red-200 bg-white text-red-700 cursor-pointer text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
            >
              {deleting && <Spinner size={14} color="#b91c1c" />}
              {deleting ? "Deleting..." : "Delete event"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
