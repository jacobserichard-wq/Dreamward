// Tailwind class strings for plan badges. Used by admin and admin/client.
//
// The mappings preserve the original inline-style hex values exactly, which
// straddle Tailwind's purple/violet and yellow/amber palettes — kept that way
// intentionally for visual fidelity. Each line corresponds to a Tailwind token
// that is an exact hex match for the original value.

const PLAN_BADGE_CLASSES: Record<string, string> = {
  trial: "bg-slate-100 text-slate-600",       // #f1f5f9 / #475569
  starter: "bg-blue-50 text-blue-700",        // #eff6ff / #1d4ed8
  growth: "bg-purple-100 text-violet-600",    // #f3e8ff / #7c3aed (mixed palette)
  pro: "bg-amber-100 text-amber-800",         // #fef3c7 / #92400e
  canceled: "bg-red-100 text-red-800",        // #fee2e2 / #991b1b
};

export function planColor(plan: string): string {
  return PLAN_BADGE_CLASSES[plan] || "";
}
