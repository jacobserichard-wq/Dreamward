// app/components/reports/ReportFilters.tsx
//
// Shared filter bar for the business reports: a Period control (preset
// ranges + custom from/to) and an optional Channel dropdown. Reports
// query contiguous date ranges, so this resolves to a single {from, to}
// (unlike the dashboard cards' non-contiguous month checklist) — one
// fetch per endpoint, the standard reporting shape.

"use client";

import { useState } from "react";

export interface ResolvedPeriod {
  preset: PeriodPreset;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  label: string;
}

export type PeriodPreset =
  | "month"
  | "quarter"
  | "ytd"
  | "lastYear"
  | "all"
  | "custom";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function resolvePeriod(
  preset: PeriodPreset,
  customFrom?: string,
  customTo?: string
): ResolvedPeriod {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = isoDate(now);
  switch (preset) {
    case "month":
      return { preset, from: `${y}-${pad2(m + 1)}-01`, to: today, label: "This month" };
    case "quarter": {
      const q = Math.floor(m / 3);
      return {
        preset,
        from: `${y}-${pad2(q * 3 + 1)}-01`,
        to: today,
        label: "This quarter",
      };
    }
    case "lastYear":
      return {
        preset,
        from: `${y - 1}-01-01`,
        to: `${y - 1}-12-31`,
        label: `${y - 1}`,
      };
    case "all":
      // Capped at the last 3 calendar years (this year + 2 prior) — going
      // back further just renders empty months for most makers.
      return {
        preset,
        from: `${y - 2}-01-01`,
        to: today,
        label: "Last 3 years",
      };
    case "custom":
      return {
        preset,
        from: customFrom || `${y}-01-01`,
        to: customTo || today,
        label: `${customFrom || "…"} – ${customTo || "…"}`,
      };
    case "ytd":
    default:
      return { preset: "ytd", from: `${y}-01-01`, to: today, label: `Year to date · ${y}` };
  }
}

const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "ytd", label: "Year to date" },
  { key: "lastYear", label: "Last year" },
  { key: "all", label: "Last 3 years" },
  { key: "custom", label: "Custom…" },
];

export interface ReportFiltersProps {
  period: ResolvedPeriod;
  onPeriodChange: (p: ResolvedPeriod) => void;
  channel: string;
  onChannelChange: (c: string) => void;
  channels: { id: string; label: string }[];
  showChannel?: boolean;
}

export default function ReportFilters({
  period,
  onPeriodChange,
  channel,
  onChannelChange,
  channels,
  showChannel = true,
}: ReportFiltersProps) {
  const [customFrom, setCustomFrom] = useState(period.from);
  const [customTo, setCustomTo] = useState(period.to);

  const selectClass =
    "py-1.5 px-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500";

  return (
    <div className="flex items-end gap-4 flex-wrap mb-5">
      <div>
        <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">
          Period
        </label>
        <select
          value={period.preset}
          onChange={(e) =>
            onPeriodChange(
              resolvePeriod(e.target.value as PeriodPreset, customFrom, customTo)
            )
          }
          className={selectClass}
        >
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {period.preset === "custom" && (
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">
              From
            </label>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => {
                setCustomFrom(e.target.value);
                onPeriodChange(resolvePeriod("custom", e.target.value, customTo));
              }}
              className={selectClass}
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">
              To
            </label>
            <input
              type="date"
              value={customTo}
              onChange={(e) => {
                setCustomTo(e.target.value);
                onPeriodChange(resolvePeriod("custom", customFrom, e.target.value));
              }}
              className={selectClass}
            />
          </div>
        </div>
      )}

      {showChannel && (
        <div>
          <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">
            Channel
          </label>
          <select
            value={channel}
            onChange={(e) => onChannelChange(e.target.value)}
            className={selectClass}
          >
            <option value="all">All channels</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
