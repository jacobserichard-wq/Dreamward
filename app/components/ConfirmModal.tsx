// app/components/ConfirmModal.tsx
//
// UX First-Run commit 1 of 11. Shared destructive-op modal — replaces
// the few remaining `window.confirm()` calls (clearSampleData first;
// follow-ups for dismissChecklist + invoice-dismiss). Pattern mirrors
// FetchFromGmailModal from Phase 6.5 for visual consistency.
//
// Pure-presentational. Caller owns open/close state and the work the
// confirm button triggers. Esc-to-cancel + click-outside-to-cancel
// both fire onCancel (unless busy is true).

"use client";

import { useEffect } from "react";

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  /** Defaults to "Confirm". */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** Red confirm button when true; blue otherwise. */
  danger?: boolean;
  /** Disables confirm + shows "..." instead of the label. Used while
   *  the parent's mutation is in flight. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  // Esc-to-cancel. Bound globally while open so an unfocused modal
  // body still responds. Skipped while busy to avoid cancelling an
  // in-flight mutation by accident.
  useEffect(() => {
    if (!open || busy) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmTone = danger
    ? "bg-red-600 hover:bg-red-700"
    : "bg-blue-500 hover:bg-blue-600";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-message"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        // Stop click-through on the modal body.
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
      >
        <h2
          id="confirm-modal-title"
          className="text-lg font-bold text-slate-900 m-0 mb-2"
        >
          {title}
        </h2>
        <p
          id="confirm-modal-message"
          className="text-sm text-slate-600 m-0 mb-5"
        >
          {message}
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="py-2 px-4 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer disabled:opacity-40 hover:bg-slate-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`py-2 px-4 text-sm font-semibold text-white rounded-lg border-0 cursor-pointer disabled:opacity-60 ${confirmTone}`}
          >
            {busy ? "..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
