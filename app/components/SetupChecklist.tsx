// app/components/SetupChecklist.tsx
//
// UX First-Run commit 7 of 11. Designed in
// session-notes/ux-firstrun-design.md §4 + §5.
//
// Pure-presentational checklist surface for the home-page dashboard.
// Renders up to 7 setup steps; visibility per item is plan-gated +
// each item's done-state is derived from runtime data already loaded
// on the home page (no extra fetches inside this component).
//
// Self-hides when:
//   - preferences.ux.checklist_dismissed_at is set, OR
//   - all visible items are done
//
// Page owns every mutation (clear sample, upload click) — this
// component just renders + calls back.

"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";

export interface SetupChecklistProps {
  plan: "trial" | "starter" | "growth" | "pro";
  // Derived signals from existing home-page data:
  gmailConnected: boolean;          // any processed_item with source='gmail'
  hasRealProcessedItems: boolean;   // any source != 'sample'
  hasSampleItems: boolean;          // any source == 'sample'
  homeAddressSet: boolean;          // settings.homeAddress non-null
  cpaEmailSet: boolean;             // settings.preferences.cpa.email non-empty
  taxBracketSet: boolean;           // settings.preferences.taxBracket defined
  proCallBooked: boolean;           // clients.pro_call_booked_at non-null
  // Mutation hooks (page-owned):
  onDismiss: () => void;
  onClearSample: () => void;
  onUploadClick: () => void;
}

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  action:
    | { kind: "signIn" }
    | { kind: "upload" }
    | { kind: "clearSample" }
    | { kind: "link"; href: string }
    | { kind: "linkHash"; href: string };
  buttonLabel: string;
  // Plans where this item should appear. Mirrors §4 of the design doc.
  visibleOn: Array<"trial" | "starter" | "growth" | "pro">;
}

export default function SetupChecklist(props: SetupChecklistProps) {
  const items: ChecklistItem[] = [
    {
      id: "gmail",
      label: "Connect Gmail to auto-pull invoices",
      done: props.gmailConnected,
      action: { kind: "signIn" },
      buttonLabel: "Connect",
      // Sub-session 24 follow-up: tightened from growth+pro to pro
      // only. Matches the /api/gmail Pro-gate from commit 1 + the
      // README's Pro-only marketing of Gmail auto-fetch.
      visibleOn: ["pro"],
    },
    {
      id: "upload",
      label: "Upload your first file or process an email",
      done: props.hasRealProcessedItems,
      action: { kind: "upload" },
      buttonLabel: "Upload",
      visibleOn: ["trial", "starter", "growth", "pro"],
    },
    {
      id: "home_address",
      label: "Add your home address (needed for mileage)",
      done: props.homeAddressSet,
      action: { kind: "link", href: "/settings" },
      buttonLabel: "Open Settings",
      visibleOn: ["trial", "starter", "growth", "pro"],
    },
    {
      id: "sample_cleared",
      label: "Clear the sample data when you're ready",
      done: !props.hasSampleItems,
      action: { kind: "clearSample" },
      buttonLabel: "Clear",
      visibleOn: ["starter", "growth", "pro"],
    },
    {
      id: "cpa_email",
      label: "Set your CPA's email for one-click handoff",
      done: props.cpaEmailSet,
      action: { kind: "link", href: "/settings" },
      buttonLabel: "Open Settings",
      visibleOn: ["pro"],
    },
    {
      id: "tax_bracket",
      label: "Set your tax bracket for quarterly estimates",
      done: props.taxBracketSet,
      action: { kind: "link", href: "/settings" },
      buttonLabel: "Open Settings",
      visibleOn: ["pro"],
    },
    {
      id: "onboarding_call",
      label: "Book your white-glove onboarding call",
      done: props.proCallBooked,
      action: { kind: "link", href: "/welcome-pro" },
      buttonLabel: "Book",
      visibleOn: ["pro"],
    },
  ];

  const visible = items.filter((i) => i.visibleOn.includes(props.plan));
  const doneCount = visible.filter((i) => i.done).length;

  // Self-hide when nothing left to do. (Dismissal is handled at the
  // page level — page won't render us at all when dismissed_at set.)
  if (visible.length === 0 || doneCount === visible.length) return null;

  const percent = Math.round((doneCount / visible.length) * 100);

  return (
    <div
      // Visual hierarchy: brighter than the surrounding banners, sits
      // at the top of the dashboard to anchor the first-time experience.
      className="bg-white border border-slate-200 rounded-xl p-5 mb-6 shadow-sm"
    >
      <div className="flex justify-between items-start mb-3 gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-slate-900 m-0 mb-1">
            Get FlowWork running
          </h2>
          <p className="text-sm text-slate-500 m-0">
            {doneCount} of {visible.length} steps complete
          </p>
        </div>
        <button
          type="button"
          onClick={props.onDismiss}
          aria-label="Hide this checklist"
          title="Hide this checklist"
          className="text-slate-400 hover:text-slate-600 cursor-pointer text-xl leading-none px-2 py-1"
        >
          {"×"}
        </button>
      </div>

      {/* Progress bar */}
      <div
        className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-4"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ul className="space-y-2 m-0 p-0 list-none">
        {visible.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {/* Checkbox circle — filled green when done */}
              <span
                className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[11px] font-bold transition-colors ${
                  item.done
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : "border-slate-300 text-transparent"
                }`}
              >
                {item.done ? "✓" : ""}
              </span>
              <span
                className={`truncate ${item.done ? "text-slate-400 line-through" : "text-slate-700"}`}
              >
                {item.label}
              </span>
            </div>
            {!item.done && <ActionButton action={item.action} label={item.buttonLabel} onClearSample={props.onClearSample} onUploadClick={props.onUploadClick} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Per-item action button. Five action kinds map to four mutation
// mechanisms (signIn, upload click, sample-clear, link nav). Keeps
// the JSX above tidy.
function ActionButton({
  action,
  label,
  onClearSample,
  onUploadClick,
}: {
  action: ChecklistItem["action"];
  label: string;
  onClearSample: () => void;
  onUploadClick: () => void;
}) {
  const buttonClass =
    "flex-shrink-0 text-xs font-semibold py-1.5 px-3 rounded-md border border-blue-300 bg-white text-blue-700 hover:bg-blue-50 cursor-pointer no-underline";

  switch (action.kind) {
    case "signIn":
      return (
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/" })}
          className={buttonClass}
        >
          {label} {"→"}
        </button>
      );
    case "upload":
      return (
        <button type="button" onClick={onUploadClick} className={buttonClass}>
          {label} {"→"}
        </button>
      );
    case "clearSample":
      return (
        <button type="button" onClick={onClearSample} className={buttonClass}>
          {label} {"→"}
        </button>
      );
    case "link":
    case "linkHash":
      return (
        <Link href={action.href} className={buttonClass}>
          {label} {"→"}
        </Link>
      );
  }
}
