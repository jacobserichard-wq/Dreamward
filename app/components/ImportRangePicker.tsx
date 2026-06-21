// app/components/ImportRangePicker.tsx
//
// Connect-time "how far back to import" picker, shared by every outside
// source (Plaid, Shopify, Square, Etsy, Wix). Self-contained: manages the
// preset + custom date internally and bubbles the resolved start date
// (YYYY-MM-DD, or null = all history) to the parent via onChange. The
// parent sends that value to its connect/exchange endpoint.
//
// Default is "This year" — the common case for a maker who wants the
// current tax year, not a multi-year dump (the whole reason this exists).

"use client";

import { useEffect, useState } from "react";
import {
  type ImportRangePreset,
  IMPORT_RANGE_LABELS,
  resolveImportStartDate,
} from "@/lib/importRange";

export default function ImportRangePicker({
  onChange,
  defaultPreset = "this_year",
  disabled = false,
  className = "",
}: {
  /** Called with the resolved start date (YYYY-MM-DD) or null (all history)
   *  on mount and whenever the selection changes. Wrap in useCallback so
   *  the effect below doesn't re-fire each parent render. */
  onChange: (startDate: string | null) => void;
  defaultPreset?: ImportRangePreset;
  disabled?: boolean;
  className?: string;
}) {
  const [preset, setPreset] = useState<ImportRangePreset>(defaultPreset);
  const [customDate, setCustomDate] = useState("");

  // Bubble the resolved date up on mount + on every change.
  useEffect(() => {
    onChange(resolveImportStartDate(preset, customDate));
  }, [preset, customDate, onChange]);

  const presets: ImportRangePreset[] = [
    "this_year",
    "last_12_months",
    "all",
    "custom",
  ];

  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        Import transactions from
      </label>
      <div className="flex gap-2 flex-wrap">
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value as ImportRangePreset)}
          disabled={disabled}
          className="py-1.5 px-2.5 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
        >
          {presets.map((p) => (
            <option key={p} value={p}>
              {IMPORT_RANGE_LABELS[p]}
            </option>
          ))}
        </select>
        {preset === "custom" && (
          <input
            type="date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            disabled={disabled}
            className="py-1.5 px-2.5 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
          />
        )}
      </div>
      <p className="text-[11px] text-slate-400 mt-1 m-0">
        {preset === "all"
          ? "Imports your full available history."
          : preset === "custom"
            ? "Imports transactions on or after the date you pick."
            : "Skips older transactions so you don't import a multi-year dump."}
      </p>
    </div>
  );
}
