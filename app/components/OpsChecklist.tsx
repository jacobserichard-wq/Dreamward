"use client";

// Founder operations checklist for the owner dashboard. Daily / weekly /
// monthly / yearly "keep it running" items from the ops runbook
// (session-notes/founder-ops-runbook.md), as tickable boxes.
//
// Period-aware: each check stores the PERIOD KEY it was ticked in, and an
// item only reads as done while that key matches the CURRENT period — so a
// daily item auto-clears tomorrow, a weekly one next week, etc. No manual
// reset. Items the system/a provider already watches carry an "Auto" badge.
// Manual items are clickable ("how? ▸") to reveal step-by-step directions.
// The weekly health signals are also emailed every Monday
// (/api/cron/founder-digest).

import { useState, useEffect } from "react";

type Cadence = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
interface Item {
  id: string;
  label: string;
  /** Short pointer shown under AUTO items. */
  how?: string;
  /** If set, this item is watched automatically — names what watches it. */
  auto?: string;
  /** Step-by-step directions for a MANUAL item; revealed on click. */
  desc?: string[];
}
const CHECKLIST: { group: string; cadence: Cadence; resets: string; items: Item[] }[] = [
  {
    group: "Daily",
    cadence: "daily",
    resets: "each day",
    items: [
      {
        id: "d-deploys",
        label: "Deploys green, no 500 spike",
        desc: [
          "Vercel → open the Dreamward project → Deployments tab.",
          "Newest deploy on main should read Ready (green). A red Error → click it and read the build log.",
          "Open Logs / Observability → filter to Errors or status 500. A spike over your normal baseline means investigate that route.",
        ],
      },
      {
        id: "d-cron",
        label: "Nightly cron ran",
        desc: [
          "The daily cron is /api/cron (runs 14:00 UTC — Etsy reconciliation + Plaid sync).",
          "Vercel → project → Crons tab → confirm /api/cron shows a recent run.",
          "Or Logs → filter path /api/cron → confirm a 200 in the last 24h with no thrown error.",
        ],
      },
      {
        id: "d-support",
        label: "Support inbox",
        desc: [
          "Open Gmail for dreamwardsystems@gmail.com — all app reply-to lands here.",
          "Scan for customer questions or replies; respond or triage.",
        ],
      },
      {
        id: "d-stripe",
        label: "Stripe failed charges / disputes",
        how: "Stripe → Payments (live mode)",
        auto: "Stripe emails disputes",
      },
    ],
  },
  {
    group: "Weekly",
    cadence: "weekly",
    resets: "each week",
    items: [
      {
        id: "w-sync",
        label: "Integration sync health",
        how: "Emailed Mondays — or SQL: *_connections last_sync_status='failed'",
        auto: "Monday digest",
      },
      {
        id: "w-plaid",
        label: "Plaid re-auth needed?",
        how: "Plaid → Items (ITEM_LOGIN_REQUIRED)",
        auto: "Monday digest",
      },
      {
        id: "w-signups",
        label: "Signups & conversions",
        how: "Metrics above ↑",
        auto: "Monday digest",
      },
      {
        id: "w-email",
        label: "Email deliverability",
        desc: [
          "resend.com → Emails / Logs.",
          "Check the week's delivered-vs-bounced ratio — a rising bounce/complaint rate hurts sender reputation.",
          "Spot-check that a recent app email shows Delivered.",
        ],
      },
      {
        id: "w-db",
        label: "DB connections + backups",
        how: "SQL: pg_stat_activity; Railway → Backups",
        auto: "Monday digest (conn. count)",
      },
      {
        id: "w-deps",
        label: "Dependabot alerts",
        how: "GitHub → Security · patch Critical/High ≤7d (security-policy §6)",
        auto: "GitHub Dependabot",
      },
    ],
  },
  {
    group: "Monthly",
    cadence: "monthly",
    resets: "each month",
    items: [
      {
        id: "m-pnl",
        label: "Costs vs revenue",
        desc: [
          "Revenue: the MRR + bands at the top of this page.",
          "Costs: tally Vercel, Railway, Resend, Plaid (Billing — $0.30 × connected accounts), Anthropic (console Usage) into the Operating costs card.",
          "Confirm Net / mo is positive and each band stays margin-positive.",
        ],
      },
      {
        id: "m-ai",
        label: "AI features still alive",
        desc: [
          "Trigger one AI feature — e.g. upload a PDF invoice and let it parse, or run a categorize.",
          "If it works, the pinned Anthropic model is live.",
          "If you see 'AI processing failed' everywhere, the model id was likely retired (404) — a code fix (~5 files); send it to me.",
        ],
      },
      {
        id: "m-books",
        label: "Books spot-check",
        desc: [
          "Open one real customer's account (or the admin client view).",
          "Reports → check: revenue = sales − refunds, COGS / margin sane, sales tax separated.",
          "Catches silent calc regressions before customers do.",
        ],
      },
      {
        id: "m-house",
        label: "Housekeeping",
        desc: [
          "DB size: SELECT pg_size_pretty(pg_database_size(current_database())); and SELECT count(*) FROM processed_items;.",
          "Churn: review cancellations / downgrades in Stripe.",
          "Note upcoming token / key expiries; rotate if warranted.",
        ],
      },
    ],
  },
  {
    group: "Quarterly",
    cadence: "quarterly",
    resets: "each quarter",
    items: [
      {
        id: "q-eol",
        label: "EOL / dependency review",
        desc: [
          "Check Node.js (Vercel runtime), Next.js, Postgres (Railway) + key deps vs end-of-support dates — `npm outdated` gives a quick view.",
          "Upgrade anything approaching EOL before support ends.",
          "This is the practice behind the Plaid 'monitors EOL software' security attestation — doing it keeps that attestation honest.",
        ],
      },
      {
        id: "q-secpolicy",
        label: "Re-date the security policy",
        desc: [
          "Open session-notes/security-policy.md, confirm each control still reflects reality, and update its Effective/Review date.",
          "Plaid security attestations were signed 2026-07-05 and are due again 2026-12-22 — re-attest by then.",
        ],
      },
    ],
  },
  {
    group: "Yearly",
    cadence: "yearly",
    resets: "each year",
    items: [
      {
        id: "y-taxes",
        label: "Year-end taxes / 1099s",
        desc: [
          "Export year-end reports for your accountant.",
          "Send 1099s to any contractor paid over $600.",
          "Hand off to your CPA.",
        ],
      },
      {
        id: "y-domain",
        label: "Renew domain + verify registrant email",
        desc: [
          "Namecheap → Domain List → godreamward.com → confirm auto-renew is on (or renew).",
          "Verify the registrant email is current and verified — an unverified Whois email triggers a hold that parks the whole site offline.",
        ],
      },
      {
        id: "y-secrets",
        label: "Rotate keys / review secrets",
        desc: [
          "Review Stripe, Resend, Plaid keys + the token-encryption key.",
          "Rotate anything old or possibly exposed and update it in Vercel env vars.",
        ],
      },
      {
        id: "y-pricing",
        label: "Review pricing vs costs",
        desc: [
          "Compare the band ladder to your actual per-customer costs (Plaid, infra, AI).",
          "Adjust bands if margins have drifted.",
        ],
      },
      {
        id: "y-policies",
        label: "Review Terms & Privacy currency",
        desc: [
          "Re-read Terms + Privacy for accuracy.",
          "Confirm subprocessors are current (Plaid, Stripe, Resend) — update as integrations change.",
        ],
      },
    ],
  },
];

const STORE = "dw-ops-checklist";
const COLLAPSE = "dw-ops-checklist-collapsed";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
/** Current period key for a cadence. Stored on a check; an item is "done"
 *  only while its stored key still equals this — auto-clears when the
 *  period rolls over. */
function periodKey(cadence: Cadence, d: Date): string {
  const y = d.getFullYear();
  switch (cadence) {
    case "daily":
      return `D${y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    case "weekly": {
      const m = new Date(d);
      m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); // Monday of this week
      return `W${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(m.getDate())}`;
    }
    case "monthly":
      return `M${y}-${pad(d.getMonth() + 1)}`;
    case "quarterly":
      return `Q${y}-${Math.floor(d.getMonth() / 3) + 1}`;
    case "yearly":
      return `Y${y}`;
  }
}

export default function OpsChecklist() {
  const [checked, setChecked] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState(true);
  const [openDesc, setOpenDesc] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) setChecked(JSON.parse(raw) as Record<string, string>);
      if (localStorage.getItem(COLLAPSE) === "false") setCollapsed(false);
    } catch {
      /* ignore */
    }
  }, []);

  const persist = (next: Record<string, string>) => {
    setChecked(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const isDone = (id: string, cadence: Cadence): boolean =>
    checked[id] === periodKey(cadence, new Date());
  const toggle = (id: string, cadence: Cadence) => {
    const next = { ...checked };
    if (isDone(id, cadence)) delete next[id];
    else next[id] = periodKey(cadence, new Date());
    persist(next);
  };
  const toggleDesc = (id: string) =>
    setOpenDesc((o) => ({ ...o, [id]: !o[id] }));
  const setCollapse = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem(COLLAPSE, String(v));
    } catch {
      /* ignore */
    }
  };

  const total = CHECKLIST.reduce((n, g) => n + g.items.length, 0);
  const done = CHECKLIST.reduce(
    (n, g) => n + g.items.filter((i) => isDone(i.id, g.cadence)).length,
    0
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <button
        onClick={() => setCollapse(!collapsed)}
        className="flex w-full items-center justify-between gap-3 bg-transparent border-0 p-0 cursor-pointer text-left"
      >
        <h2 className="text-sm font-semibold text-slate-700 m-0 uppercase tracking-wide">
          Operations checklist
        </h2>
        <span className="text-xs text-slate-500 flex items-center gap-2">
          <span className="tabular-nums">
            {done}/{total} done
          </span>
          <span className="text-slate-400">{collapsed ? "▸" : "▾"}</span>
        </span>
      </button>

      {!collapsed && (
        <div className="mt-4 space-y-5">
          <p className="text-xs text-slate-500 m-0 flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 py-px">
              Auto
            </span>
            = the system or a provider already watches this and alerts you;
            tap any other item for how to do it.
          </p>
          {CHECKLIST.map((g) => {
            const groupDone = g.items.filter((i) => isDone(i.id, g.cadence)).length;
            return (
              <div key={g.group}>
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider m-0">
                    {g.group}{" "}
                    <span className="text-slate-400 font-normal normal-case tracking-normal">
                      ({groupDone}/{g.items.length})
                    </span>
                  </h3>
                  <span className="text-[11px] text-slate-400 normal-case">
                    ↻ resets {g.resets}
                  </span>
                </div>
                <ul className="m-0 p-0 list-none space-y-1.5">
                  {g.items.map((i) => {
                    const isChecked = isDone(i.id, g.cadence);
                    const open = !!openDesc[i.id];
                    return (
                      <li key={i.id}>
                        <div className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggle(i.id, g.cadence)}
                            aria-label={i.label}
                            className="mt-1 cursor-pointer accent-emerald-600 flex-shrink-0"
                          />
                          <div className="leading-snug flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {i.desc ? (
                                <button
                                  onClick={() => toggleDesc(i.id)}
                                  className="bg-transparent border-0 p-0 cursor-pointer text-left"
                                  aria-expanded={open}
                                >
                                  <span
                                    className={`text-sm ${
                                      isChecked
                                        ? "line-through text-slate-400"
                                        : "text-slate-700"
                                    }`}
                                  >
                                    {i.label}
                                  </span>
                                  <span className="text-[11px] text-blue-600 ml-1.5">
                                    {open ? "hide ▾" : "how? ▸"}
                                  </span>
                                </button>
                              ) : (
                                <span
                                  className={`text-sm ${
                                    isChecked
                                      ? "line-through text-slate-400"
                                      : "text-slate-700"
                                  }`}
                                >
                                  {i.label}
                                </span>
                              )}
                              {i.auto && (
                                <span className="whitespace-nowrap">
                                  <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 py-px">
                                    Auto
                                  </span>
                                  <span className="text-[10px] text-slate-400 ml-1">
                                    {i.auto}
                                  </span>
                                </span>
                              )}
                            </div>
                            {i.desc
                              ? open && (
                                  <ol className="mt-1 mb-1 ml-4 list-decimal text-xs text-slate-500 space-y-0.5">
                                    {i.desc.map((s, k) => (
                                      <li key={k}>{s}</li>
                                    ))}
                                  </ol>
                                )
                              : i.how && (
                                  <span className="block text-xs text-slate-400">
                                    {i.how}
                                  </span>
                                )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          <p className="text-xs text-slate-400 m-0 pt-1 border-t border-slate-100">
            Checks clear themselves as each period rolls over — no manual reset.
            Full directions in <code>session-notes/founder-ops-runbook.md</code>;
            weekly health signals are also emailed every Monday.
          </p>
        </div>
      )}
    </div>
  );
}
