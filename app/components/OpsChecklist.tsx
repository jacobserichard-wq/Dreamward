"use client";

// Founder operations checklist for the owner dashboard. Daily / weekly /
// monthly / yearly "keep it running" items from the ops runbook
// (session-notes/founder-ops-runbook.md), as tickable boxes.
//
// Period-aware: instead of a manual reset, each check stores the PERIOD
// KEY it was ticked in (e.g. a daily item stores today's date, a monthly
// item stores "2026-06"). An item only reads as done when its stored key
// matches the CURRENT period — so a daily item auto-clears tomorrow, a
// weekly one next week, etc. No resetting by hand. The weekly health
// signals are also emailed every Monday (/api/cron/founder-digest).

import { useState, useEffect } from "react";

type Cadence = "daily" | "weekly" | "monthly" | "yearly";
interface Item {
  id: string;
  label: string;
  how: string;
  /** If set, this item is watched automatically — the string names what
   *  does the watching (e.g. "Monday digest"). Absent = manual check. */
  auto?: string;
}
const CHECKLIST: { group: string; cadence: Cadence; resets: string; items: Item[] }[] = [
  {
    group: "Daily",
    cadence: "daily",
    resets: "each day",
    items: [
      { id: "d-deploys", label: "Deploys green, no 500 spike", how: "Vercel → Deployments + Logs" },
      { id: "d-cron", label: "Nightly cron ran", how: "Vercel → Crons / Logs (/api/cron)" },
      { id: "d-support", label: "Support inbox", how: "Gmail: dreamwardsystems@gmail.com" },
      { id: "d-stripe", label: "Stripe failed charges / disputes", how: "Stripe → Payments (live mode)", auto: "Stripe emails disputes" },
    ],
  },
  {
    group: "Weekly",
    cadence: "weekly",
    resets: "each week",
    items: [
      { id: "w-sync", label: "Integration sync health", how: "Emailed Mondays — or SQL: *_connections last_sync_status='failed'", auto: "Monday digest" },
      { id: "w-plaid", label: "Plaid re-auth needed?", how: "Plaid → Items (ITEM_LOGIN_REQUIRED)", auto: "Monday digest" },
      { id: "w-signups", label: "Signups & conversions", how: "Metrics above ↑", auto: "Monday digest" },
      { id: "w-email", label: "Email deliverability", how: "Resend → Logs (bounce rate)" },
      { id: "w-db", label: "DB connections + backups", how: "SQL: pg_stat_activity; Railway → Backups", auto: "Monday digest (conn. count)" },
      { id: "w-deps", label: "Dependabot alerts", how: "GitHub → Security", auto: "GitHub Dependabot" },
    ],
  },
  {
    group: "Monthly",
    cadence: "monthly",
    resets: "each month",
    items: [
      { id: "m-pnl", label: "Costs vs revenue", how: "Metrics above + provider billing (Plaid $0.30/acct)" },
      { id: "m-ai", label: "AI features still alive", how: "Trigger one AI feature; 'AI processing failed' = retired model" },
      { id: "m-books", label: "Books spot-check", how: "A customer's Reports: revenue − refunds, COGS, tax" },
      { id: "m-house", label: "Housekeeping", how: "DB size, churn, token/secret expiries" },
    ],
  },
  {
    group: "Yearly",
    cadence: "yearly",
    resets: "each year",
    items: [
      { id: "y-taxes", label: "Year-end taxes / 1099s", how: "Export reports; CPA handoff" },
      { id: "y-domain", label: "Renew domain + verify registrant email", how: "Namecheap — avoids the Whois-hold outage" },
      { id: "y-secrets", label: "Rotate keys / review secrets", how: "Stripe, Resend, Plaid, token-encryption key" },
      { id: "y-pricing", label: "Review pricing vs costs", how: "Bands vs infra spend (this page)" },
      { id: "y-policies", label: "Review Terms & Privacy currency", how: "Subprocessors: Plaid, Stripe, Resend" },
    ],
  },
];

const STORE = "dw-ops-checklist";
const COLLAPSE = "dw-ops-checklist-collapsed";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
/** The current period key for a cadence. Stored on a check; an item is
 *  "done" only while its stored key still equals this — so it auto-clears
 *  when the period rolls over. */
function periodKey(cadence: Cadence, d: Date): string {
  const y = d.getFullYear();
  switch (cadence) {
    case "daily":
      return `D${y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    case "weekly": {
      // Key on the Monday of the current week (no ISO-week edge cases).
      const m = new Date(d);
      m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
      return `W${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(m.getDate())}`;
    }
    case "monthly":
      return `M${y}-${pad(d.getMonth() + 1)}`;
    case "yearly":
      return `Y${y}`;
  }
}

export default function OpsChecklist() {
  // id -> the period key it was last checked in.
  const [checked, setChecked] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState(true);

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
            = the system or a provider already watches this and alerts you; the
            rest are manual checks.
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
                    const done = isDone(i.id, g.cadence);
                    return (
                      <li key={i.id}>
                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={done}
                            onChange={() => toggle(i.id, g.cadence)}
                            className="mt-1 cursor-pointer accent-emerald-600"
                          />
                          <span className="leading-snug">
                            <span
                              className={`text-sm ${
                                done ? "line-through text-slate-400" : "text-slate-700"
                              }`}
                            >
                              {i.label}
                            </span>
                            {i.auto && (
                              <span className="ml-1.5 align-middle whitespace-nowrap">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 py-px">
                                  Auto
                                </span>
                                <span className="text-[10px] text-slate-400 ml-1">
                                  {i.auto}
                                </span>
                              </span>
                            )}
                            <span className="block text-xs text-slate-400">{i.how}</span>
                          </span>
                        </label>
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
