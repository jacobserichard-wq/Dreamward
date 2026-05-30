// app/components/ReclassifyModal.tsx
//
// Phase 13 polish. Lightweight modal for re-tagging a single
// processed_items row's channel — primary use case: fixing
// auto-classified income rows that landed in "Forwarded
// invoices" (Gmail) or "Uncategorized" (Uploads) when they
// should have been "Wholesale", "Shopify", "Service work",
// etc.
//
// Channel-only edit. Vendor / amount / category / date stay
// untouched — those have other edit surfaces (/expenses for
// expense-type rows, future /income for income rows). The
// goal here is fast re-tag, not full row edit.
//
// PATCH /api/items with { id, channel } persists. The
// classifier's explicit-channel-beats-derivation logic
// (lib/profitability/channels.ts:classifyIncomeRow) makes
// the change stick across re-aggregations.

"use client";

import { useEffect, useState } from "react";
import Spinner from "./Spinner";
import {
  CANONICAL_CHANNELS,
  type ChannelMeta,
} from "@/lib/profitability/channels";

export interface ReclassifyModalRow {
  id: string | number;
  vendor: string;
  amount: number;
  /** Currently-assigned channel id (or null/undefined if the
   *  row has never had an explicit channel set). Drives the
   *  dropdown's initial selection. */
  channel: string | null | undefined;
}

export interface ReclassifyModalProps {
  open: boolean;
  row: ReclassifyModalRow | null;
  onClose: () => void;
  onSaved: () => void;
}

// Exclude coming-soon channels — no point letting the merchant
// re-tag to a channel that doesn't accept data yet.
const SELECTABLE_CHANNELS: readonly ChannelMeta[] =
  CANONICAL_CHANNELS.filter((c) => !c.comingSoon);

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function ReclassifyModal({
  open,
  row,
  onClose,
  onSaved,
}: ReclassifyModalProps) {
  const [picked, setPicked] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset dropdown to the row's current channel each time the
  // modal opens with a new row.
  useEffect(() => {
    if (!open || !row) return;
    setPicked(row.channel ?? "");
    setError(null);
  }, [open, row]);

  // Esc to close
  useEffect(() => {
    if (!open || saving) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, saving, onClose]);

  if (!open || !row) return null;

  const handleSave = async () => {
    if (!picked) {
      setError("Pick a channel.");
      return;
    }
    if (picked === row.channel) {
      // No-op — close without a network call
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, channel: picked }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const currentMeta = SELECTABLE_CHANNELS.find((c) => c.id === row.channel);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reclassify-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
      >
        <h2
          id="reclassify-modal-title"
          className="text-lg font-bold text-slate-900 m-0 mb-1"
        >
          Reclassify channel
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-4">
          Picking a channel here overrides the auto-classifier. Sticks
          across re-aggregations until you change it again.
        </p>

        {/* Row preview */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4">
          <p className="text-sm font-medium text-slate-900 m-0 truncate">
            {row.vendor || "Unknown"}
          </p>
          <p className="text-xs text-slate-500 m-0 mt-0.5">
            {fmtUsd(row.amount)}
            {currentMeta && (
              <>
                {" · currently in "}
                <span className="inline-flex items-center gap-1">
                  <span>{currentMeta.icon}</span>
                  <span>{currentMeta.label}</span>
                </span>
              </>
            )}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        <label
          htmlFor="reclassify-channel"
          className="block text-xs font-medium text-slate-700 mb-1"
        >
          Channel
        </label>
        <select
          id="reclassify-channel"
          value={picked}
          onChange={(e) => {
            setPicked(e.target.value);
            setError(null);
          }}
          disabled={saving}
          className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
        >
          <option value="">— pick a channel —</option>
          {SELECTABLE_CHANNELS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.label}
            </option>
          ))}
        </select>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="py-2 px-4 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer disabled:opacity-40 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !picked}
            className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving && <Spinner size={12} color="white" />}
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
