"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "../../components/PageHeader";
import Spinner from "../../components/Spinner";
import ErrorBanner from "../../components/ErrorBanner";
import { type EventResponse } from "../../components/EventCreateForm";

interface EventItem {
  id: number;
  eventId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  createdAt: string;
}

interface LinkedTransactions {
  count: number;
  totalAmount: number;
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

export default function EventDetailPage({ params }: PageProps) {
  const { id: rawId } = use(params);
  const router = useRouter();

  const [event, setEvent] = useState<EventResponse | null>(null);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [linkedTx, setLinkedTx] = useState<LinkedTransactions | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form state — separate from loaded event so the user can edit freely.
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [multiDay, setMultiDay] = useState(false);
  const [venue, setVenue] = useState("");
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
    const res = await fetch(`/api/events/${encodeURIComponent(rawId)}`);
    if (res.status === 401) {
      router.replace(`/signin?callbackUrl=/events/${encodeURIComponent(rawId)}`);
      return;
    }
    if (res.status === 403) {
      // Starter — redirect to /events where the upgrade prompt lives.
      router.replace("/events");
      return;
    }
    if (res.status === 404) {
      setError("Event not found.");
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError(`Couldn't load event: HTTP ${res.status}`);
      setLoading(false);
      return;
    }
    const data = (await res.json()) as {
      event: EventResponse;
      items: EventItem[];
      linkedTransactions: LinkedTransactions;
    };
    setEvent(data.event);
    setLinkedTx(data.linkedTransactions);
    populateForm(data.event, data.items);
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
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">Loading event...</p>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
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

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
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

        {/* Linked uploads readout — the headline number (§5.4 / §8.1) */}
        <div className="bg-white rounded-xl border border-slate-200 py-5 px-6 mb-6">
          <p className="text-xs text-slate-500 uppercase tracking-wider m-0 mb-2">
            Sales from linked uploads
          </p>
          <p className="text-3xl font-bold text-slate-900 m-0 mb-1">
            ${formatMoney(linkedTotal)}
          </p>
          <p className="text-sm text-slate-500 m-0">
            across {linkedCount} {linkedCount === 1 ? "transaction" : "transactions"}
          </p>
          {(manualRevenue > 0 || itemsSum > 0) && (
            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {manualRevenue > 0 && (
                <div>
                  <span className="text-slate-500">Manual revenue: </span>
                  <span className="font-semibold text-slate-700">
                    ${formatMoney(manualRevenue)}
                  </span>
                </div>
              )}
              {itemsSum > 0 && (
                <div>
                  <span className="text-slate-500">Line-item total: </span>
                  <span className="font-semibold text-slate-700">
                    ${formatMoney(itemsSum)}
                  </span>
                </div>
              )}
            </div>
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
                  Revenue (manual)
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
