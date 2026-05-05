"use client";

import { useEffect } from "react";

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
  autoDismissMs?: number;
}

export default function ErrorBanner({
  message,
  onDismiss,
  autoDismissMs = 7000,
}: ErrorBannerProps) {
  useEffect(() => {
    if (!autoDismissMs) return;
    const t = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(t);
  }, [message, autoDismissMs, onDismiss]);

  return (
    <div role="alert" style={s.banner}>
      <span style={s.icon} aria-hidden>{"⚠️"}</span>
      <span style={s.text}>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={s.dismiss}
        aria-label="Dismiss error"
      >
        {"✕"}
      </button>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderLeft: "4px solid #dc2626",
    color: "#991b1b",
    padding: "12px 14px 12px 16px",
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 14,
  },
  icon: { fontSize: 16, lineHeight: 1, flexShrink: 0 },
  text: { flex: 1, lineHeight: 1.4 },
  dismiss: {
    background: "none",
    border: "none",
    color: "#991b1b",
    cursor: "pointer",
    fontSize: 16,
    padding: "2px 6px",
    borderRadius: 4,
    lineHeight: 1,
    flexShrink: 0,
  },
};
