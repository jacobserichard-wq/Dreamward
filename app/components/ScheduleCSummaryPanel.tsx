// Schedule C summary panel — rolls byCategory.expense up to the IRS
// Form 1040 Schedule C Part II line numbers. The mapping lives in
// lib/categories.ts (each Category carries an optional `scheduleC`
// field with the line number); lib/reports/aggregate.ts builds the
// per-line totals + category lists with buildScheduleCSummary.
//
// This panel is the front-end mirror of the CSV ScheduleC Summary
// section (lib/reports/csv.ts) and the PDF Schedule C Summary block
// (lib/pdf/annual.tsx). Renders nothing when no categories mapped.
//
// Per Phase 7c design §1 #6: every Schedule C surface MUST carry a
// "verify with your CPA" footnote so the user understands this is a
// planning aid, not advice.

interface ScheduleCSummaryRow {
  line: string;
  description: string;
  total: number;
  categories: string[];
}

interface ScheduleCSummaryPanelProps {
  year: number;
  rows: ScheduleCSummaryRow[];
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function ScheduleCSummaryPanel({
  year,
  rows,
}: ScheduleCSummaryPanelProps) {
  if (rows.length === 0) return null;

  const grandTotal = rows.reduce((acc, r) => acc + r.total, 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <h3 className="text-base font-semibold text-slate-900 m-0 mb-1">
        Schedule C summary
      </h3>
      <p className="text-xs text-slate-500 m-0 mb-4">
        Your {year} expenses rolled up to IRS Form 1040 Schedule C Part II
        line numbers. Use this as a starting point — your CPA will verify
        the mapping before filing.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="py-2 pr-3 font-medium w-16">Line</th>
              <th className="py-2 pr-3 font-medium">Description</th>
              <th className="py-2 pr-3 font-medium">Categories</th>
              <th className="py-2 pl-3 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.line}
                className="border-b border-slate-100 last:border-b-0"
              >
                <td className="py-2 pr-3 align-top">
                  <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-blue-50 text-blue-700 border border-blue-200">
                    L{row.line}
                  </span>
                </td>
                <td className="py-2 pr-3 text-slate-700 align-top">
                  {row.description}
                </td>
                <td className="py-2 pr-3 text-xs text-slate-500 align-top">
                  {row.categories.join(", ")}
                </td>
                <td className="py-2 pl-3 text-right font-medium text-slate-900 tabular-nums whitespace-nowrap align-top">
                  {formatUsd(row.total)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300">
              <td className="py-2 pr-3" />
              <td className="py-2 pr-3 font-semibold text-slate-900">
                Total mapped expenses
              </td>
              <td />
              <td className="py-2 pl-3 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                {formatUsd(grandTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-400 mt-3 mb-0">
        Mapping is based on FlowWork&apos;s default category-to-line table.
        Unusual situations (Section 179, COGS for resellers, mixed-use
        property, etc.) may shift the right line. Always verify with your
        CPA before filing.
      </p>
    </div>
  );
}
