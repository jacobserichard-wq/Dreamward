// lib/aging.ts
//
// Pure aging-bucket derivation. No I/O. Reused by the GET /api/invoices
// list endpoint and by UI components (AgingBucketChip, dashboard card).
//
// Buckets are derived, not stored — per phase-6-ar-design.md §1 #7,
// bucket boundaries are policy that may change (some businesses use
// 15/30/60/90 instead of 30/60/90+). Storing would require a daily
// cron sweep; computing in JS per-row is sub-millisecond at Dreamward
// scale (small vendors, hundreds of invoices each).

export type AgingBucket =
  | "Paid"
  | "Written off"
  | "Current"
  | "1–30 days"
  | "31–60 days"
  | "61–90 days"
  | "91+ days";

export interface InvoiceForAging {
  status: string;                  // open | partial | paid | written_off
  due_date: string;                // YYYY-MM-DD (per pg DATE-parser override)
  amount_total: number | string;   // pg NUMERIC comes as string
  amount_paid: number | string;
}

/**
 * Derives the aging bucket for one invoice as of a reference date
 * (defaults to now). All math is done at UTC midnight on both sides to
 * avoid the same class of tz-drift bug sub-session 19 fixed in the pg
 * DATE parser.
 */
export function computeAgingBucket(
  inv: InvoiceForAging,
  today: Date = new Date(),
): AgingBucket {
  if (inv.status === "written_off") return "Written off";
  const outstanding = Number(inv.amount_total) - Number(inv.amount_paid);
  if (inv.status === "paid" || outstanding <= 0) return "Paid";

  // Parse YYYY-MM-DD as UTC midnight; same on the today side.
  const due = new Date(inv.due_date + "T00:00:00Z");
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  const dayMs = 1000 * 60 * 60 * 24;
  const daysOverdue = Math.floor((todayUtc.getTime() - due.getTime()) / dayMs);

  if (daysOverdue <= 0) return "Current";
  if (daysOverdue <= 30) return "1–30 days";
  if (daysOverdue <= 60) return "31–60 days";
  if (daysOverdue <= 90) return "61–90 days";
  return "91+ days";
}

/**
 * Tailwind class strings for each bucket. Consumed by AgingBucketChip
 * and the dashboard card tint logic.
 *
 * Scheme: slate (neutral) for Current and Written off, emerald for
 * Paid, then amber → orange → red increasing in urgency through the
 * overdue buckets. 91+ bumps to red-100/red-900 so it stands out
 * against the other red shades.
 */
export function bucketColor(bucket: AgingBucket): {
  bg: string;
  fg: string;
  border: string;
} {
  switch (bucket) {
    case "Paid":          return { bg: "bg-emerald-50",  fg: "text-emerald-700", border: "border-emerald-200" };
    case "Written off":   return { bg: "bg-slate-100",   fg: "text-slate-500",   border: "border-slate-200" };
    case "Current":       return { bg: "bg-slate-50",    fg: "text-slate-700",   border: "border-slate-200" };
    case "1–30 days":     return { bg: "bg-amber-50",    fg: "text-amber-800",   border: "border-amber-200" };
    case "31–60 days":    return { bg: "bg-orange-50",   fg: "text-orange-800",  border: "border-orange-200" };
    case "61–90 days":    return { bg: "bg-red-50",      fg: "text-red-700",     border: "border-red-200" };
    case "91+ days":      return { bg: "bg-red-100",     fg: "text-red-900",     border: "border-red-300" };
  }
}

/**
 * True when the invoice is past due (not Current, Paid, or Written off).
 * Used by the dashboard outstanding-balance card to compute the red/amber
 * tint condition (>50% of outstanding in overdue buckets).
 */
export function isOverdue(bucket: AgingBucket): boolean {
  return bucket !== "Current" && bucket !== "Paid" && bucket !== "Written off";
}

/**
 * Ordered list of buckets used to render the bucket-totals row on the
 * /invoices list page. Excludes Paid and Written off — those don't get
 * their own bucket chips in the aging summary (they're filterable via
 * the status dropdown instead).
 */
export const AGING_BUCKETS_ORDERED: AgingBucket[] = [
  "Current",
  "1–30 days",
  "31–60 days",
  "61–90 days",
  "91+ days",
];
