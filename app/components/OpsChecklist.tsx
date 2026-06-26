"use client";

// Founder operations checklist for the owner dashboard. The daily /
// weekly / monthly "keep it running" items from the ops runbook
// (session-notes/founder-ops-runbook.md), as tickable boxes. Checks
// persist in localStorage; each group has a Reset to clear it at the
// start of a new day/week/month. The weekly health signals are ALSO
// emailed every Monday (/api/cron/founder-digest) — this is the manual
// reference + tick-off companion.

import { useState, useEffect } from "react";

interface Item {
  id: string;
  label: string;
  how: string;
}
const CHECKLIST: { group: string; items: Item[] }[] = [
  {
    group: "Daily",
    items: [
      { id: "d-deploys", label: "Deploys green, no 500 spike", how: "Vercel → Deployments + Logs" },
      { id: "d-cron", label: "Nightly cron ran", how: "Vercel → Crons / Logs (/api/cron)" },
      { id: "d-support", label: "Support inbox", how: "Gmail: dreamwardsystems@gmail.com" },
      { id: "d-stripe", label: "Stripe failed charges / disputes", how: "Stripe → Payments (live mode)" },
    ],
  },
  {
    group: "Weekly",
    items: [
      { id: "w-sync", label: "Integration sync health", how: "Emailed Mondays — or SQL: *_connections last_sync_status='failed'" },
      { id: "w-plaid", label: "Plaid re-auth needed?", how: "Plaid → Items (ITEM_LOGIN_REQUIRED)" },
      { id: "w-signups", label: "Signups & conversions", how: "Metrics above ↑" },
      { id: "w-email", label: "Email deliverability", how: "Resend → Logs (bounce rate)" },
      { id: "w-db", label: "DB connections + backups", how: "SQL: pg_stat_activity; Railway → Backups" },
      { id: "w-deps", label: "Dependabot alerts", how: "GitHub → Security" },
    ],
  },
  {
    group: "Monthly",
    items: [
      { id: "m-pnl", label: "Costs vs revenue", how: "Metrics above + provider billing (Plaid $0.30/acct)" },
      { id: "m-ai", label: "AI features still alive", how: "Trigger one AI feature; 'AI processing failed' = retired model" },
      { id: "m-books", label: "Books spot-check", how: "A customer's Reports: revenue − refunds, COGS, tax" },
      { id: "m-house", label: "Housekeeping", how: "DB size, churn, token/secret expiries" },
    ],
  },
];

const STORE = "dw-ops-checklist";
const COLLAPSE = "dw-ops-checklist-collapsed";

export default function OpsChecklist() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) setChecked(JSON.parse(raw) as Record<string, boolean>);
      if (localStorage.getItem(COLLAPSE) === "false") setCollapsed(false);
    } catch {
      /* ignore */
    }
  }, []);

  const persist = (next: Record<string, boolean>) => {
    setChecked(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const toggle = (id: string) => persist({ ...checked, [id]: !checked[id] });
  const resetGroup = (ids: string[]) => {
    const next = { ...checked };
    ids.forEach((id) => delete next[id]);
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
    (n, g) => n + g.items.filter((i) => checked[i.id]).length,
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
          {CHECKLIST.map((g) => {
            const ids = g.items.map((i) => i.id);
            const groupDone = ids.filter((id) => checked[id]).length;
            return (
              <div key={g.group}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider m-0">
                    {g.group}{" "}
                    <span className="text-slate-400 font-normal normal-case tracking-normal">
                      ({groupDone}/{ids.length})
                    </span>
                  </h3>
                  <button
                    onClick={() => resetGroup(ids)}
                    className="text-xs text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer"
                  >
                    Reset
                  </button>
                </div>
                <ul className="m-0 p-0 list-none space-y-1.5">
                  {g.items.map((i) => (
                    <li key={i.id}>
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!checked[i.id]}
                          onChange={() => toggle(i.id)}
                          className="mt-1 cursor-pointer accent-emerald-600"
                        />
                        <span className="leading-snug">
                          <span
                            className={`text-sm ${
                              checked[i.id]
                                ? "line-through text-slate-400"
                                : "text-slate-700"
                            }`}
                          >
                            {i.label}
                          </span>
                          <span className="block text-xs text-slate-400">
                            {i.how}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <p className="text-xs text-slate-400 m-0 pt-1 border-t border-slate-100">
            Full directions in <code>session-notes/founder-ops-runbook.md</code>.
            The weekly health signals are also emailed every Monday.
          </p>
        </div>
      )}
    </div>
  );
}
