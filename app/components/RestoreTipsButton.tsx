// app/components/RestoreTipsButton.tsx
//
// Clears the per-tip localStorage dismissal flags written by
// SectionTip ("tip-dismissed-<id>"), so all the dismissed how-to
// callouts reappear. Dismissals are device-local + permanent
// otherwise — this is the only way back if a user X'd one out (handy
// for non-accountant users leaning on the guidance).

"use client";

import { useState } from "react";

const PREFIX = "tip-dismissed-";

export default function RestoreTipsButton() {
  const [result, setResult] = useState<{ count: number } | null>(null);

  const restore = () => {
    let count = 0;
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(PREFIX)) keys.push(k);
      }
      for (const k of keys) window.localStorage.removeItem(k);
      count = keys.length;
    } catch {
      // localStorage blocked — nothing to clear.
    }
    setResult({ count });
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={restore}
        className="inline-flex items-center gap-1.5 py-2 px-3.5 rounded-lg text-sm font-semibold border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 cursor-pointer transition-colors"
      >
        <span aria-hidden="true">{"\u{1F4A1}"}</span> Restore help tips
      </button>
      {result && (
        <span className="text-sm text-slate-600">
          {result.count > 0
            ? `Restored ${result.count} tip${result.count === 1 ? "" : "s"} — they'll reappear as you visit each page.`
            : "No tips were hidden."}
        </span>
      )}
    </div>
  );
}
