// Small colored chip rendering one aging bucket (Current / 1–30 days /
// 31–60 days / 61–90 days / 91+ days / Paid / Written off).
//
// Two modes:
//   - Display only: just the label colored per lib/aging.bucketColor.
//   - Selectable: with `selected` + `onClick`, becomes a clickable
//     filter chip; `count` and `amount` render below the label for the
//     bucket-totals bar on the /invoices list page.

import type { AgingBucket } from "@/lib/aging";
import { bucketColor } from "@/lib/aging";

interface AgingBucketChipProps {
  bucket: AgingBucket;
  /** When provided, renders as a clickable filter chip with totals. */
  count?: number;
  /** Amount outstanding in this bucket (formatted as USD). */
  amount?: number;
  /** Bold ring when this bucket is the active filter. */
  selected?: boolean;
  /** Click handler — when set, the chip becomes a button. */
  onClick?: () => void;
  /** Compact pill mode (used inline in invoice list rows). */
  compact?: boolean;
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function AgingBucketChip({
  bucket,
  count,
  amount,
  selected,
  onClick,
  compact,
}: AgingBucketChipProps) {
  const c = bucketColor(bucket);

  if (compact) {
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${c.bg} ${c.fg} ${c.border}`}
      >
        {bucket}
      </span>
    );
  }

  const hasTotals = count !== undefined || amount !== undefined;
  const baseClasses = `flex flex-col items-start justify-center text-left rounded-xl border px-3 py-2.5 ${c.bg} ${c.fg} ${c.border}`;
  const interactiveClasses = onClick
    ? `cursor-pointer transition-all ${
        selected
          ? "ring-2 ring-slate-900/40 shadow-sm"
          : "hover:shadow-sm"
      }`
    : "";

  const inner = (
    <>
      <span className="text-xs font-semibold uppercase tracking-wide opacity-80">
        {bucket}
      </span>
      {hasTotals && (
        <>
          <span className="text-base font-bold mt-0.5">
            {amount !== undefined ? formatUsd(amount) : ""}
          </span>
          <span className="text-[11px] opacity-70 mt-0.5">
            {count ?? 0} {count === 1 ? "invoice" : "invoices"}
          </span>
        </>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClasses} ${interactiveClasses} min-w-[120px]`}
      >
        {inner}
      </button>
    );
  }

  return <div className={baseClasses}>{inner}</div>;
}
