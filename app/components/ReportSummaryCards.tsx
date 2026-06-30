// Five summary cards rendered across the top of /reports. Pure
// presentational; consumes the AnnualSummary.summary block.
//
// Layout: grid-cols-2 on mobile, sm:grid-cols-3, md:grid-cols-5 at
// desktop so 320px stays readable.

interface ReportSummaryCardsProps {
  revenue: number;
  expenses: number;
  boothFees: number;
  mileageCost: number;
  totalMiles: number;
  netProfit: number;
  // Phase 13: when > 0, the layout splits Expenses into COGS +
  // Operating Expenses and surfaces Gross Profit between them.
  // When 0 (or undefined for legacy callers), the original 5-card
  // layout renders.
  cogs?: number;
  grossProfit?: number;
  operatingExpenses?: number;
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface CardProps {
  label: string;
  value: string;
  sub?: string;
  icon: string;
  borderClass: string;
  valueToneClass?: string;
}

function Card({ label, value, sub, icon, borderClass, valueToneClass }: CardProps) {
  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 border-t-[3px] p-4 sm:p-5 ${borderClass}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base sm:text-lg">{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </span>
      </div>
      <div className={`text-xl sm:text-2xl font-bold m-0 ${valueToneClass ?? "text-slate-900"}`}>
        {value}
      </div>
      {sub && (
        <div className="text-xs text-slate-500 mt-1">{sub}</div>
      )}
    </div>
  );
}

export default function ReportSummaryCards({
  revenue,
  expenses,
  boothFees,
  mileageCost,
  totalMiles,
  netProfit,
  cogs,
  grossProfit,
  operatingExpenses,
}: ReportSummaryCardsProps) {
  const netProfitTone =
    netProfit > 0 ? "text-green-700" : netProfit < 0 ? "text-red-700" : "text-slate-900";
  const showCogsLayout = (cogs ?? 0) > 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6">
      <Card
        label="Revenue"
        value={formatUsd(revenue)}
        icon={"\u{1F4B0}"}
        borderClass="border-t-green-600"
      />
      {showCogsLayout && (
        <>
          <Card
            label="Cost of goods (cash basis)"
            value={formatUsd(cogs ?? 0)}
            icon={"\u{1F4E6}"}
            borderClass="border-t-orange-500"
          />
          <Card
            label="Gross profit"
            value={formatUsd(grossProfit ?? 0)}
            sub="Revenue − COGS"
            icon={"\u{1F4CA}"}
            borderClass="border-t-emerald-500"
            valueToneClass="text-emerald-800"
          />
        </>
      )}
      <Card
        label={showCogsLayout ? "Operating expenses" : "Expenses"}
        value={formatUsd(
          showCogsLayout ? (operatingExpenses ?? 0) : expenses
        )}
        icon={"\u{1F4B3}"}
        borderClass="border-t-red-600"
      />
      <Card
        label="Booth fees"
        value={formatUsd(boothFees)}
        icon={"\u{1F3EA}"}
        borderClass="border-t-amber-500"
      />
      <Card
        label="Mileage"
        value={formatUsd(mileageCost)}
        sub={`${totalMiles.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi deduction`}
        icon={"\u{1F697}"}
        borderClass="border-t-blue-500"
      />
      <Card
        label="Net profit"
        value={formatUsd(netProfit)}
        icon={netProfit > 0 ? "\u{1F4C8}" : netProfit < 0 ? "\u{1F4C9}" : "\u{2696}\u{FE0F}"}
        borderClass={netProfit > 0 ? "border-t-emerald-600" : netProfit < 0 ? "border-t-red-700" : "border-t-slate-400"}
        valueToneClass={netProfitTone}
      />
    </div>
  );
}
