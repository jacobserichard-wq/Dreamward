// Income + expense category breakdowns rendered side-by-side at
// desktop, stacked on mobile. Both lists are already sorted total-
// descending by lib/reports.ts.
//
// Expense rows additionally surface the taxDeductible flag from
// lib/categories.ts:
//   - true  → green "tax deductible" pill
//   - false → slate "not deductible" pill
//   - null  → "deductibility unspecified" muted pill (the Phase 5
//             convention for categories where timing / Section 179
//             elections make a single boolean misleading)
//
// Phase 7c commit 9: expense rows also carry a Schedule C line
// badge ("L18", "L8", etc.) when the category has a mapping in
// lib/categories.ts. Badge omitted (not rendered) for categories
// without a mapping — matches the PDF + CSV behavior.

interface IncomeRow {
  category: string;
  count: number;
  total: number;
}

interface ExpenseRow {
  category: string;
  count: number;
  total: number;
  taxDeductible: boolean | null;
  scheduleCLine: string | null;
  // Phase 13: true when the underlying category is tagged
  // isCogs in lib/categories.ts. Drives the COGS/Operating
  // subsection split when at least one row qualifies.
  isCogs: boolean;
}

interface ReportByCategoryTableProps {
  income: IncomeRow[];
  expense: ExpenseRow[];
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function DeductibilityPill({ value }: { value: boolean | null }) {
  if (value === true) {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        deductible
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-50 text-slate-600 border border-slate-200">
        not deductible
      </span>
    );
  }
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-50 text-slate-500 border border-slate-200">
      unspecified
    </span>
  );
}

export default function ReportByCategoryTable({
  income,
  expense,
}: ReportByCategoryTableProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {/* Income */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-base font-semibold text-slate-900 m-0 mb-3">
          Income by category
        </h3>
        {income.length === 0 ? (
          <p className="text-sm text-slate-500 italic m-0">
            No income recorded for this year.
          </p>
        ) : (
          <ul className="space-y-1.5 m-0 p-0 list-none">
            {income.map((row) => (
              <li
                key={row.category}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <div className="min-w-0 flex-1 truncate">
                  <span className="text-slate-700">{row.category}</span>
                  <span className="text-xs text-slate-400 ml-1.5">
                    ({row.count} {row.count === 1 ? "row" : "rows"})
                  </span>
                </div>
                <span className="font-medium text-slate-900 tabular-nums whitespace-nowrap">
                  {formatUsd(row.total)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Expense */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-base font-semibold text-slate-900 m-0 mb-3">
          Expenses by category
        </h3>
        {expense.length === 0 ? (
          <p className="text-sm text-slate-500 italic m-0">
            No expenses recorded for this year.
          </p>
        ) : (
          <ExpenseList rows={expense} />
        )}
      </div>
    </div>
  );
}

// Phase 13 polish: split into "Cost of Goods Sold" + "Operating
// Expenses" subsections when at least one row is tagged isCogs.
// Matches the Summary section's COGS/Gross Profit/Operating
// layout from commit 5 of Phase 13. When zero COGS rows, the
// original single flat list renders unchanged.
function ExpenseList({ rows }: { rows: ExpenseRow[] }) {
  const cogsRows = rows.filter((r) => r.isCogs);
  const opexRows = rows.filter((r) => !r.isCogs);

  if (cogsRows.length === 0) {
    return (
      <ul className="space-y-1.5 m-0 p-0 list-none">
        {opexRows.map((row) => (
          <ExpenseLi key={row.category} row={row} />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-[10px] uppercase tracking-wide text-slate-500 m-0 mb-2 font-semibold">
          Cost of Goods Sold
        </h4>
        <ul className="space-y-1.5 m-0 p-0 list-none">
          {cogsRows.map((row) => (
            <ExpenseLi key={row.category} row={row} />
          ))}
        </ul>
      </div>
      <div>
        <h4 className="text-[10px] uppercase tracking-wide text-slate-500 m-0 mb-2 font-semibold">
          Operating Expenses
        </h4>
        {opexRows.length === 0 ? (
          <p className="text-xs text-slate-500 italic m-0">None</p>
        ) : (
          <ul className="space-y-1.5 m-0 p-0 list-none">
            {opexRows.map((row) => (
              <ExpenseLi key={row.category} row={row} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ExpenseLi({ row }: { row: ExpenseRow }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-slate-700 truncate">{row.category}</span>
          <DeductibilityPill value={row.taxDeductible} />
          {row.scheduleCLine && (
            <span
              title={`Schedule C Part II Line ${row.scheduleCLine}`}
              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-blue-50 text-blue-700 border border-blue-200"
            >
              L{row.scheduleCLine}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-400">
          {row.count} {row.count === 1 ? "row" : "rows"}
        </div>
      </div>
      <span className="font-medium text-slate-900 tabular-nums whitespace-nowrap">
        {formatUsd(row.total)}
      </span>
    </li>
  );
}
