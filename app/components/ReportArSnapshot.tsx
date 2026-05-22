// AR snapshot panel at the bottom of /reports. Pure presentational.
// Consumes the AnnualSummary.ar block.
//
// outstandingAsOfYearEnd is computed SQL-side at the year's EOY in
// lib/reports.ts (design §1 #8) — when a prior-year report is run
// later, this number reflects what was open as of that year's
// Dec 31, NOT what's open at report-generation time.

interface ReportArSnapshotProps {
  year: number;
  invoicesIssued: number;
  invoicesPaid: number;
  amountCollected: number;
  outstandingAsOfYearEnd: number;
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface StatProps {
  label: string;
  value: string;
  sub?: string;
}

function Stat({ label, value, sub }: StatProps) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
        {label}
      </div>
      <div className="text-lg font-semibold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function ReportArSnapshot({
  year,
  invoicesIssued,
  invoicesPaid,
  amountCollected,
  outstandingAsOfYearEnd,
}: ReportArSnapshotProps) {
  const hasAnyAr =
    invoicesIssued > 0 ||
    invoicesPaid > 0 ||
    amountCollected > 0 ||
    outstandingAsOfYearEnd > 0;

  if (!hasAnyAr) {
    return null;
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <h3 className="text-base font-semibold text-slate-900 m-0 mb-1">
        AR snapshot
      </h3>
      <p className="text-xs text-slate-500 m-0 mb-4">
        Wholesale and consignment invoice activity for {year}. Outstanding
        balance reflects what was unpaid as of {year}-12-31.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat
          label="Invoices issued"
          value={String(invoicesIssued)}
          sub={`in ${year}`}
        />
        <Stat
          label="Invoices paid"
          value={String(invoicesPaid)}
          sub="received any payment"
        />
        <Stat label="Amount collected" value={formatUsd(amountCollected)} />
        <Stat
          label="Outstanding at year end"
          value={formatUsd(outstandingAsOfYearEnd)}
          sub={`as of ${year}-12-31`}
        />
      </div>
    </div>
  );
}
