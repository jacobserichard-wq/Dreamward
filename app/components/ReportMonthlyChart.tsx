"use client";

// Monthly trend chart for /reports. Renders three lines (revenue /
// expenses / net profit) over the 12 months of the selected year.
// recharts is already in deps from Phase 5 (sub-session 19 uses it
// on /profitability). LineChart with ResponsiveContainer for mobile.

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface MonthlyEntry {
  month: string; // YYYY-MM
  revenue: number;
  expenses: number;
  netProfit: number;
}

interface ReportMonthlyChartProps {
  data: MonthlyEntry[];
}

function shortMonthLabel(yyyymm: string): string {
  // "2026-03" → "Mar"
  const m = Number(yyyymm.slice(5, 7));
  const names = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return names[m - 1] ?? yyyymm;
}

function formatUsd(n: number): string {
  // Compact form for chart tooltips: $1.2k for thousands, exact for under.
  if (Math.abs(n) >= 1000) {
    return `$${(n / 1000).toFixed(1)}k`;
  }
  return `$${n.toFixed(0)}`;
}

export default function ReportMonthlyChart({ data }: ReportMonthlyChartProps) {
  // Tag rows with a short month label for the X axis.
  const tagged = data.map((d) => ({
    ...d,
    label: shortMonthLabel(d.month),
  }));

  const hasAnyValue = tagged.some(
    (d) => d.revenue !== 0 || d.expenses !== 0 || d.netProfit !== 0
  );

  if (!hasAnyValue) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <h3 className="text-base font-semibold text-slate-900 m-0 mb-3">
          By month
        </h3>
        <p className="text-sm text-slate-500 italic m-0">
          No transactions in any month of this year.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <h3 className="text-base font-semibold text-slate-900 m-0 mb-3">
        By month
      </h3>
      <p className="text-xs text-slate-500 m-0 mb-3">
        Monthly net is revenue minus expenses (booth fees + mileage are
        attributed annually, not by month).
      </p>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          <LineChart data={tagged} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
            <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={formatUsd} />
            <Tooltip
              formatter={(value) => {
                const n = typeof value === "number" ? value : Number(value);
                if (!Number.isFinite(n)) return String(value ?? "");
                return `$${n.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="revenue"
              name="Revenue"
              stroke="#16a34a"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="expenses"
              name="Expenses"
              stroke="#dc2626"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="netProfit"
              name="Net profit"
              stroke="#2563eb"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
