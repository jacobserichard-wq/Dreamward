// app/components/SetupChecklist.tsx
//
// UX First-Run commit 7 of 11 (sub-session 24, UX arc).
// Extended in flow-redesign commit 3 of 8 (sub-session 24, flow arc)
// with per-item skip plumbing + "Show N skipped" expander.
//
// Pure-presentational checklist surface. Renders up to 7 setup steps;
// visibility per item is plan-gated + each item's done-state is derived
// from runtime data passed in by the parent (no fetches in this
// component).
//
// Self-hides when:
//   - preferences.ux.checklist_dismissed_at is set (parent gate), OR
//   - all visible non-skipped items are done
//
// Page owns every mutation (clear sample, upload click, skip, unskip).
//
// Backward-compat: the new skipped/onSkip/onUnskip props are optional
// with safe defaults (empty map + no-op callbacks). The dashboard call
// site (UX First-Run commit 7) keeps working unchanged; flow-redesign
// commit 4 wires the new behavior in.

"use client";

import { useState } from "react";
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
  // Flow-redesign commit 3: per-item skip plumbing. Optional for
  // backward compat — dashboard call site can omit these and skip
  // behavior is silently absent.
  /** Map of itemId → ISO timestamp when skipped. Absent key = not skipped. */
  skipped?: Record<string, string>;
  /** Called when the user clicks the per-item Skip button. Parent
   *  typically opens a ConfirmModal then PATCHes preferences. */
  onSkip?: (itemId: string) => void;
  /** Called when the user clicks "Un-skip" in the expander. Immediate;
   *  no confirmation (un-skipping is non-destructive). */
  onUnskip?: (itemId: string) => void;
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
  // Plans where this item should appear.
  visibleOn: Array<"trial" | "starter" | "growth" | "pro">;
  // Flow-redesign commit 3: whether the user can skip this item.
  // Defaults true. The future "tell_us_about_business" item (commit 5)
  // will be the first non-skippable item — industry pick drives AI
  // categorization, can't be defaulted away.
  skippable?: boolean;
}

export default function SetupChecklist(props: SetupChecklistProps) {
  // Local expander state for the "Show N skipped items" section.
  // Defaults closed — user opts in to seeing the skipped list.
  const [showSkipped, setShowSkipped] = useState(false);

  const skipped = props.skipped ?? {};

  const items: ChecklistItem[] = [
    {
      id: "gmail",
      label: "Connect Gmail to auto-pull invoices",
      done: props.gmailConnected,
      action: { kind: "signIn" },
      buttonLabel: "Connect",
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

  // Visible-for-this-plan, minus any item the user has skipped.
  const planVisible = items.filter((i) => i.visibleOn.includes(props.plan));
  const visible = planVisible.filter((i) => !skipped[i.id]);
  // Skipped items shown to this user (skipped + plan-visible only —
  // a Trial user who skipped a Pro item that was never visible to
  // them doesn't see it here either).
  const skippedVisible = planVisible.filter((i) => skipped[i.id]);

  const doneCount = visible.filter((i) => i.done).length;

  // Self-hide when nothing left to do.
  if (visible.length === 0 || doneCount === visible.length) {
    // Edge case: user has skipped items but no active items left.
    // Still hide — the expander can be re-opened from /settings later
    // if we ship that surface. For v1, an empty checklist is hidden.
    return null;
  }

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

      <ul className="space-y-3 m-0 p-0 list-none">
        {visible.map((item) => (
          <li key={item.id} className="text-sm">
            <div className="flex items-center justify-between gap-3">
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
              {!item.done && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <ActionButton
                    action={item.action}
                    label={item.buttonLabel}
                    onClearSample={props.onClearSample}
                    onUploadClick={props.onUploadClick}
                  />
                  {/* Flow-redesign commit 3: per-item skip. Renders
                      only when onSkip is provided (backward compat for
                      the dashboard call site until commit 4 wires it)
                      and the item is skippable (skippable !== false). */}
                  {props.onSkip && item.skippable !== false && (
                    <button
                      type="button"
                      onClick={() => props.onSkip?.(item.id)}
                      title={`Skip "${item.label}" permanently`}
                      className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer bg-transparent border-0 px-1"
                    >
                      Skip
                    </button>
                  )}
                </div>
              )}
            </div>
            {item.id === "gmail" && !item.done && (
              <div className="pl-7 mt-1">
                <Link
                  href="/help/gmail-setup"
                  className="text-xs text-blue-600 hover:underline"
                >
                  What labels do I need? {"\u{2192}"}
                </Link>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Flow-redesign commit 3: "Show N skipped" expander. Only
          renders when skipped items exist AND parent provided onUnskip
          (so users can actually un-skip from inside the component).
          Mirrors the existing "Show hidden defaults" pattern in
          /settings — collapsed by default, opt-in to revisit. */}
      {skippedVisible.length > 0 && props.onUnskip && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setShowSkipped((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer bg-transparent border-0 p-0"
            aria-expanded={showSkipped}
          >
            {showSkipped
              ? `− Hide ${skippedVisible.length} skipped item${skippedVisible.length === 1 ? "" : "s"}`
              : `+ Show ${skippedVisible.length} skipped item${skippedVisible.length === 1 ? "" : "s"}`}
          </button>
          {showSkipped && (
            <ul className="mt-2 space-y-1.5 m-0 p-0 list-none">
              {skippedVisible.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="text-slate-400 line-through truncate">
                    {item.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => props.onUnskip?.(item.id)}
                    title={`Show "${item.label}" again`}
                    className="text-blue-600 hover:underline cursor-pointer bg-transparent border-0 p-0 flex-shrink-0"
                  >
                    Un-skip
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// Per-item action button. Five action kinds map to four mutation
// mechanisms (signIn, upload click, sample-clear, link nav).
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
          // Flow-redesign commit 1: callbackUrl bumped from "/" to
          // "/dashboard" since the root is now the marketing landing.
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
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
