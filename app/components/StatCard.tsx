// app/components/StatCard.tsx
//
// UX First-Run commit 2 of 11. Extracted from the inline definition
// in app/page.tsx so other surfaces can adopt the same card pattern,
// and so we can add the `tooltip` prop without bloating the home
// page further.
//
// New `tooltip` prop renders a small ⓘ button in the top-right
// corner that surfaces explanatory text via the native `title`
// attribute. v1 design choice (per ux-firstrun-design.md §5): native
// tooltip is desktop-friendly + zero-dep + a11y-friendly. A custom
// hover-tooltip can replace it later without an API change.

interface StatCardProps {
  label: string;
  value: string | number;
  /** Smaller secondary text below the label. Existing dashboard cards
   *  use this for "$1,525.00" under "Overdue: 2". */
  sub?: string;
  icon: string;
  /** Tailwind border-top class for the colored accent stripe. */
  colorClass: string;
  /** Optional explainer surfaced on the ⓘ button's native title attr.
   *  Hidden entirely when omitted. */
  tooltip?: string;
}

export default function StatCard({
  label,
  value,
  sub,
  icon,
  colorClass,
  tooltip,
}: StatCardProps) {
  return (
    <div
      className={`relative bg-white rounded-xl p-6 text-center border border-slate-200 border-t-[3px] ${colorClass}`}
    >
      {tooltip && (
        <button
          type="button"
          // Native title is desktop-only by spec but every browser
          // honors it; mobile users get the value + label which is
          // already self-describing for our primary metrics. When we
          // ship a custom hover-tooltip later, only this button body
          // changes — the API stays.
          title={tooltip}
          aria-label={`What does ${label} mean?`}
          className="absolute top-2 right-2 w-5 h-5 rounded-full text-[11px] font-bold text-slate-400 hover:text-slate-600 cursor-help bg-transparent border-0"
        >
          ⓘ
        </button>
      )}
      <div className="text-[28px] mb-2">{icon}</div>
      <div className="text-[28px] font-extrabold text-slate-900">{value}</div>
      <div className="text-[13px] text-slate-500 mt-1">{label}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}
