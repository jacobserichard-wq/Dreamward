// app/components/SetupChecklist.tsx
//
// Sub-session 24 commit history:
//   UX First-Run commit 7  — initial dashboard checklist
//   Flow-redesign commit 3 — per-item skip plumbing + Show-Skipped expander
//   Flow-redesign commit 4 — mode prop + 3 new items + white-glove section
//
// Pure-presentational. Two rendering modes:
//
//   mode="dashboard" (default, backward-compat)
//     - Renders today's behavior: dismiss X, auto-hide when all done,
//       7 items max, no white-glove section, no form item
//
//   mode="onboarding"
//     - First-class onboarding surface — no dismiss X, "All set!" CTA
//       when all visible done, white-glove highlighted top section for
//       Pro users, includes the inline "Tell us about your business"
//       form item + add_first_event + add_first_invoice
//
// Self-hides (dashboard mode) when:
//   - preferences.ux.checklist_dismissed_at is set (parent gate), OR
//   - all visible non-skipped items are done
//
// In onboarding mode, self-hides nothing — instead renders an "All set!"
// CTA card pointing to the dashboard.
//
// Page owns every mutation (clear sample, upload click, skip, unskip,
// business-info submit).

"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { FEATURES } from "@/lib/features";

type ChecklistMode = "dashboard" | "onboarding";

export interface SetupChecklistProps {
  plan: "trial" | "dream" | "maker" | "growth" | "pro";
  /** Rendering mode. Defaults "dashboard" to preserve backward compat
   *  with the existing call site (commit 7 of the prior UX arc). */
  mode?: ChecklistMode;

  // Derived signals (existing):
  gmailConnected: boolean;
  hasRealProcessedItems: boolean;
  hasSampleItems: boolean;
  homeAddressSet: boolean;
  cpaEmailSet: boolean;
  taxBracketSet: boolean;
  proCallBooked: boolean;

  // Derived signals (new for onboarding mode):
  /** True when client.industry + client.business_name are both set. */
  industrySet?: boolean;
  /** True when the user has at least one event row. */
  hasEvents?: boolean;
  /** True when the user has at least one invoice row. */
  hasInvoices?: boolean;

  // Form state for the inline business-info item (onboarding mode):
  businessName?: string;
  industry?: string;

  // Mutation hooks (existing):
  onDismiss: () => void;
  onClearSample: () => void;
  onUploadClick: () => void;

  // Mutation hooks (skip plumbing — commit 3):
  skipped?: Record<string, string>;
  onSkip?: (itemId: string) => void;
  onUnskip?: (itemId: string) => void;

  // Mutation hooks (new — onboarding mode):
  /** Commits the inline business-info form item. Parent typically
   *  POSTs to /api/onboarding and updates clients.business_name +
   *  clients.industry. */
  onSubmitBusinessInfo?: (data: {
    businessName: string;
    industry: string;
  }) => Promise<void>;
}

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  /** Per item, the right-side action. The new "form" kind renders an
   *  inline industry-picker + business-name form (commit 4); other
   *  kinds map to standard mutation buttons (commit 3 + earlier). */
  action:
    | { kind: "signIn" }
    | { kind: "upload" }
    | { kind: "clearSample" }
    | { kind: "link"; href: string }
    | { kind: "linkHash"; href: string }
    | { kind: "form" };
  buttonLabel: string;
  visibleOn: Array<"trial" | "dream" | "maker" | "growth" | "pro">;
  skippable?: boolean;
  /** Modes where this item should render. Defaults to both. The
   *  business-info form item only makes sense on the onboarding
   *  surface (the dashboard never asks for industry/name). */
  modes?: ChecklistMode[];
}

// Industries roll over from the legacy /onboarding form so the new
// flow surfaces the same 11 options. Editing this list also
// updates the legacy form (single source of truth for sub-session 24
// onward).
const INDUSTRIES = [
  { id: "marketplace", label: "Market Vendor / Craft Seller", icon: "\u{1F3EA}" },
  { id: "freelance", label: "Freelancer / Consultant", icon: "\u{1F4BC}" },
  { id: "service", label: "Landscaping / Service Co", icon: "\u{1F333}" },
  { id: "food", label: "Food Truck / Mobile Business", icon: "\u{1F69A}" },
  { id: "ecommerce", label: "Etsy / Amazon FBA Seller", icon: "\u{1F4E6}" },
  { id: "creative", label: "Photographer / Creative", icon: "\u{1F3A8}" },
  { id: "bookkeeper", label: "Bookkeeper / Small CPA Firm", icon: "\u{1F4CA}" },
  { id: "nonprofit", label: "Nonprofit Organization", icon: "\u{2764}\u{FE0F}" },
  { id: "realestate", label: "Real Estate Investor", icon: "\u{1F3E0}" },
  { id: "fitness", label: "Personal Trainer / Coach", icon: "\u{1F3CB}\u{FE0F}" },
  { id: "other", label: "Other", icon: "\u{2699}\u{FE0F}" },
];

export default function SetupChecklist(props: SetupChecklistProps) {
  const mode: ChecklistMode = props.mode ?? "dashboard";
  const [showSkipped, setShowSkipped] = useState(false);

  // Inline form state for the business-info item (onboarding-only).
  // Initialized from props so a partially-completed value persists
  // across re-renders.
  const [bizName, setBizName] = useState(props.businessName ?? "");
  const [bizIndustry, setBizIndustry] = useState(props.industry ?? "");
  const [bizSaving, setBizSaving] = useState(false);
  const [bizError, setBizError] = useState<string | null>(null);

  const skipped = props.skipped ?? {};

  const items: ChecklistItem[] = [
    // ── Form item: industry + business name (onboarding-only) ──────
    {
      id: "tell_us_about_business",
      label: "Tell us about your business",
      done: props.industrySet ?? false,
      action: { kind: "form" },
      buttonLabel: "Save",
      visibleOn: ["trial", "dream", "maker", "growth", "pro"],
      skippable: false,                // locked decision #6 — required
      modes: ["onboarding"],           // dashboard never asks this
    },
    // ── Existing items ─────────────────────────────────────────────
    // Sub-session 33: Gmail item omitted entirely when
    // FEATURES.GMAIL_INGEST is false. Spread-conditional keeps the
    // array literal clean and re-enables instantly when the flag
    // flips back to true.
    ...(FEATURES.GMAIL_INGEST
      ? [
          {
            id: "gmail" as const,
            label: "Connect Gmail to auto-pull invoices",
            done: props.gmailConnected,
            action: { kind: "signIn" as const },
            buttonLabel: "Connect",
            visibleOn: ["pro" as const],
          },
        ]
      : []),
    {
      id: "upload",
      label: "Upload your first file or process an email",
      done: props.hasRealProcessedItems,
      action: { kind: "upload" },
      buttonLabel: "Upload",
      visibleOn: ["trial", "dream", "maker", "growth", "pro"],
    },
    {
      id: "home_address",
      label: "Add your home address (needed for mileage)",
      done: props.homeAddressSet,
      action: { kind: "link", href: "/settings" },
      buttonLabel: "Open Settings",
      visibleOn: ["trial", "dream", "maker", "growth", "pro"],
    },
    // ── New items (commit 4): event + invoice. Only meaningful on
    //    plans where those modules exist (growth + pro). ────────────
    {
      id: "add_first_event",
      label: "Add your first event (market, fair, gig)",
      done: props.hasEvents ?? false,
      action: { kind: "link", href: "/events" },
      buttonLabel: "Open Events",
      visibleOn: ["growth", "pro"],
    },
    {
      id: "add_first_invoice",
      label: "Add your first invoice (AR follow-up)",
      done: props.hasInvoices ?? false,
      action: { kind: "link", href: "/invoices" },
      buttonLabel: "Open Invoices",
      visibleOn: ["growth", "pro"],
    },
    {
      id: "sample_cleared",
      label: "Clear the sample data when you're ready",
      done: !props.hasSampleItems,
      action: { kind: "clearSample" },
      buttonLabel: "Clear",
      visibleOn: ["dream", "maker", "growth", "pro"],
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
  ];

  // White-glove item: rendered in its own highlighted section above
  // the regular list (locked decision #7). Conceptually a checklist
  // item but rendered separately for visual prominence.
  const whiteGloveItem: ChecklistItem = {
    id: "onboarding_call",
    label: "Book your white-glove onboarding call",
    done: props.proCallBooked,
    action: { kind: "link", href: "/welcome-pro" },
    buttonLabel: "Book your call",
    visibleOn: ["pro"],
  };

  // Apply mode-visibility (default = both modes), plan-visibility,
  // and skip filtering.
  const planVisible = items.filter(
    (i) =>
      i.visibleOn.includes(props.plan) &&
      (i.modes ?? ["dashboard", "onboarding"]).includes(mode)
  );
  const visible = planVisible.filter((i) => !skipped[i.id]);
  const skippedVisible = planVisible.filter((i) => skipped[i.id]);

  const whiteGloveVisible =
    mode === "onboarding" &&
    whiteGloveItem.visibleOn.includes(props.plan) &&
    !skipped[whiteGloveItem.id];

  // Total visible count INCLUDING white-glove for the progress denominator.
  const totalVisible = visible.length + (whiteGloveVisible ? 1 : 0);
  const doneCount =
    visible.filter((i) => i.done).length +
    (whiteGloveVisible && whiteGloveItem.done ? 1 : 0);

  // Dashboard self-hide: nothing left or all done. Onboarding mode
  // renders an "All set" card instead (no auto-hide).
  if (mode === "dashboard" && (visible.length === 0 || doneCount === totalVisible)) {
    return null;
  }

  // Onboarding mode "All set" CTA — replaces the checklist when every
  // visible item (incl white-glove if present) is done or skipped.
  if (mode === "onboarding" && totalVisible > 0 && doneCount === totalVisible) {
    return <AllSetCard />;
  }

  const percent = totalVisible > 0 ? Math.round((doneCount / totalVisible) * 100) : 100;

  // Headings differ by mode (design §5 table).
  const headingTitle =
    mode === "onboarding"
      ? "Welcome to FlowWork — let's get you set up"
      : "Get FlowWork running";

  const handleBizSubmit = async () => {
    if (!props.onSubmitBusinessInfo) return;
    setBizError(null);
    if (!bizName.trim()) {
      setBizError("Please enter your business name.");
      return;
    }
    if (!bizIndustry) {
      setBizError("Please pick an industry.");
      return;
    }
    setBizSaving(true);
    try {
      await props.onSubmitBusinessInfo({
        businessName: bizName.trim(),
        industry: bizIndustry,
      });
    } catch (err) {
      setBizError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBizSaving(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6 shadow-sm">
      <div className="flex justify-between items-start mb-3 gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-slate-900 m-0 mb-1">
            {headingTitle}
          </h2>
          <p className="text-sm text-slate-500 m-0">
            {doneCount} of {totalVisible} steps complete
          </p>
        </div>
        {/* Dismiss X only on dashboard mode — onboarding can't be
            dismissed (it's the whole page). */}
        {mode === "dashboard" && (
          <button
            type="button"
            onClick={props.onDismiss}
            aria-label="Hide this checklist"
            title="Hide this checklist"
            className="text-slate-400 hover:text-slate-600 cursor-pointer text-xl leading-none px-2 py-1"
          >
            {"×"}
          </button>
        )}
      </div>

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

      {/* White-glove highlighted section (onboarding + pro only) */}
      {whiteGloveVisible && !whiteGloveItem.done && (
        <div className="bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white rounded-lg p-5 mb-5">
          <div className="flex justify-between items-start gap-3 flex-wrap mb-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{"\u{1F3AF}"}</span>
              <span className="bg-amber-400 text-amber-950 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-full">
                Free — included with Pro
              </span>
            </div>
            <button
              type="button"
              onClick={() => props.onSkip?.(whiteGloveItem.id)}
              title="Skip the onboarding call"
              className="text-xs text-white/70 hover:text-white cursor-pointer bg-transparent border-0"
            >
              Skip
            </button>
          </div>
          <h3 className="text-lg font-bold m-0 mb-1">
            Book your white-glove onboarding call
          </h3>
          <p className="text-sm text-white/90 m-0 mb-4 leading-relaxed">
            A FlowWork team member walks you through Gmail setup, label
            filters, your first CSV import, and your CPA handoff —
            personally, in 30 minutes. The fastest way to get the most
            out of your Pro tier.
          </p>
          <Link
            href={whiteGloveItem.action.kind === "link" ? whiteGloveItem.action.href : "/welcome-pro"}
            className="inline-block py-2 px-5 rounded-lg bg-white text-violet-700 hover:bg-slate-100 text-sm font-semibold no-underline cursor-pointer"
          >
            {whiteGloveItem.buttonLabel} {"\u{2192}"}
          </Link>
        </div>
      )}

      <ul className="space-y-3 m-0 p-0 list-none">
        {visible.map((item) => (
          <li key={item.id} className="text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
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
              {!item.done && item.action.kind !== "form" && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <ActionButton
                    action={item.action}
                    label={item.buttonLabel}
                    onClearSample={props.onClearSample}
                    onUploadClick={props.onUploadClick}
                  />
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
            {/* Inline form for the business-info item. Renders below
                the checkbox row, inset like the Gmail help link. */}
            {!item.done && item.action.kind === "form" && (
              <div className="pl-7 mt-3 space-y-3">
                {bizError && (
                  <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-xs">
                    {bizError}
                  </div>
                )}
                <input
                  type="text"
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                  placeholder="Business name"
                  className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 box-border"
                />
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {INDUSTRIES.map((ind) => {
                    const selected = bizIndustry === ind.id;
                    return (
                      <button
                        key={ind.id}
                        type="button"
                        onClick={() => setBizIndustry(ind.id)}
                        className={`text-left p-2.5 rounded-lg border text-xs flex items-center gap-2 cursor-pointer transition-colors ${
                          selected
                            ? "border-blue-500 bg-blue-50 text-blue-900"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span className="text-base">{ind.icon}</span>
                        <span className="truncate">{ind.label}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={handleBizSubmit}
                  disabled={bizSaving}
                  className="py-2 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold cursor-pointer border-0 disabled:opacity-60"
                >
                  {bizSaving ? "Saving..." : "Save and continue"}
                </button>
              </div>
            )}
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

// "All set!" CTA card — replaces the checklist when every visible item
// is done or skipped in onboarding mode. Routes the user to the
// dashboard so they can start working.
function AllSetCard() {
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-8 text-center">
      <div className="text-5xl mb-3">{"\u{2705}"}</div>
      <h2 className="text-xl font-bold text-emerald-900 m-0 mb-2">
        You&apos;re all set!
      </h2>
      <p className="text-sm text-emerald-800 m-0 mb-5 max-w-md mx-auto">
        Setup is complete. Your dashboard is ready — start uploading
        files, processing emails, or tracking events.
      </p>
      <Link
        href="/dashboard"
        className="inline-block py-2.5 px-6 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold no-underline cursor-pointer"
      >
        Go to dashboard {"\u{2192}"}
      </Link>
    </div>
  );
}

// Per-item action button. Six action kinds map to five mutation
// mechanisms (signIn, upload, clearSample, link, form). The form
// kind is handled inline above (renders a multi-field form below
// the checkbox row); ActionButton never receives it.
function ActionButton({
  action,
  label,
  onClearSample,
  onUploadClick,
}: {
  action: Exclude<ChecklistItem["action"], { kind: "form" }>;
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
