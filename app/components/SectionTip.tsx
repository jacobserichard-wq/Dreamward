// app/components/SectionTip.tsx
//
// Sub-session 33: lightweight inline "how-to" callout. Dropped at
// the top of each major page to explain what the section is for +
// how to use it — the text-tips alternative to video tutorials.
//
// Dismissible per-tip via localStorage so power users can hide
// guidance they've internalized; it stays hidden on that device.
// The `id` namespaces the localStorage key, so each section's tip
// dismisses independently.
//
// Pure client component. Renders nothing until the mount effect
// resolves the dismissed state, to avoid a flash of a tip the user
// already dismissed (SSR can't read localStorage).

"use client";

import { useEffect, useState } from "react";

export interface SectionTipProps {
  /** Stable id — namespaces the localStorage dismissal key. */
  id: string;
  /** Short title, e.g. "Tracking gross margin". */
  title: string;
  /** The how-to body. Plain text or inline nodes. */
  children: React.ReactNode;
}

export default function SectionTip({ id, title, children }: SectionTipProps) {
  // null = not yet resolved (don't render); true/false once known.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  const storageKey = `tip-dismissed-${id}`;

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(storageKey) === "1");
    } catch {
      // localStorage blocked (private mode, etc.) — show the tip.
      setDismissed(false);
    }
  }, [storageKey]);

  if (dismissed !== false) return null;

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // ignore — best-effort persistence
    }
    setDismissed(true);
  };

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-5 flex items-start gap-3">
      <span className="text-lg leading-none mt-0.5" aria-hidden="true">
        {"\u{1F4A1}"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-blue-900 m-0 mb-0.5">{title}</p>
        <p className="text-[13px] text-blue-800 m-0 leading-relaxed">
          {children}
        </p>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        title="Dismiss this tip"
        aria-label="Dismiss this tip"
        className="flex-shrink-0 text-blue-400 hover:text-blue-700 cursor-pointer bg-transparent border-0 text-sm leading-none p-0.5"
      >
        {"\u{2715}"}
      </button>
    </div>
  );
}
