// app/components/AttachmentViewer.tsx
//
// Phase 9.4 commit 5 of 5. Modal that shows all receipt
// attachments for an expense — image previews + PDF embed +
// per-attachment delete + download link.
//
// Opens from the "View / delete" action on a transaction card
// (Dashboard › Transactions). (Was the 📎 badge on the old /expenses
// page, which merged into Transactions — left this orphaned until re-
// mounted on the card.)
// Self-fetches via GET /api/expenses/[id]/attachments on every
// open (cheap; bounded by the per-expense attachment count
// which is typically 1-3 in practice).
//
// All bytes flow through the /raw proxy route so auth + Content-
// Type are handled server-side. The blobUrl is NEVER used
// directly in src attributes — see commit message of the raw
// route for why.

"use client";

import { useCallback, useEffect, useState } from "react";
import Spinner from "./Spinner";

interface Attachment {
  id: number;
  processedItemId: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  blobUrl: string;
  uploadedAt: string;
}

export interface AttachmentViewerProps {
  open: boolean;
  /** The processed_items.id whose attachments to display. */
  expenseId: number | null;
  /** Display label for the modal title — typically the vendor name. */
  expenseLabel?: string;
  onClose: () => void;
  /** Called after a successful delete so the parent can refresh
   *  its row's attachmentCount. */
  onChanged?: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

function isPdfMime(mime: string): boolean {
  return mime === "application/pdf";
}

export default function AttachmentViewer({
  open,
  expenseId,
  expenseLabel,
  onClose,
  onChanged,
}: AttachmentViewerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (expenseId == null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/expenses/${expenseId}/attachments`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { attachments: Attachment[] };
      setAttachments(data.attachments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load attachments");
    } finally {
      setLoading(false);
    }
  }, [expenseId]);

  // Fetch fresh every open so deletions/uploads from elsewhere
  // are reflected immediately.
  useEffect(() => {
    if (open && expenseId != null) {
      void load();
    } else if (!open) {
      setAttachments([]);
      setError(null);
    }
  }, [open, expenseId, load]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && deletingId === null) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, deletingId]);

  const handleDelete = useCallback(
    async (attachmentId: number, filename: string) => {
      if (expenseId == null) return;
      if (
        !window.confirm(
          `Delete "${filename}"? This removes the receipt from storage. The expense itself stays.`
        )
      ) {
        return;
      }
      setError(null);
      setDeletingId(attachmentId);
      try {
        const res = await fetch(
          `/api/expenses/${expenseId}/attachments/${attachmentId}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || `HTTP ${res.status}`);
          return;
        }
        // Optimistic local update + parent re-fetch so the row's
        // attachmentCount badge updates without re-opening the
        // viewer.
        setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
        onChanged?.();
      } finally {
        setDeletingId(null);
      }
    },
    [expenseId, onChanged]
  );

  if (!open || expenseId == null) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="attachment-viewer-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      onClick={() => {
        if (deletingId === null) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2
            id="attachment-viewer-title"
            className="text-lg font-bold text-slate-900 m-0"
          >
            Receipts{expenseLabel ? `: ${expenseLabel}` : ""}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={deletingId !== null}
            className="text-slate-400 hover:text-slate-700 bg-transparent border-0 text-xl leading-none cursor-pointer disabled:opacity-40"
            aria-label="Close"
          >
            {"\u{00D7}"}
          </button>
        </div>
        <p className="text-xs text-slate-500 m-0 mb-4">
          Receipts stay private to your account. Bytes proxy through
          Dreamward; the underlying blob storage is signed-URL gated.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-center p-10 text-slate-500 text-sm">
            Loading attachments…
          </p>
        ) : attachments.length === 0 ? (
          <p className="text-center p-10 text-slate-500 text-sm italic">
            No receipts attached.
          </p>
        ) : (
          <ul className="m-0 p-0 list-none space-y-4">
            {attachments.map((a) => {
              const src = `/api/expenses/${expenseId}/attachments/${a.id}/raw`;
              return (
                <li
                  key={a.id}
                  className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50"
                >
                  <div className="flex items-center justify-between gap-3 px-3 py-2 bg-white border-b border-slate-100">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate m-0">
                        {a.filename}
                      </p>
                      <p className="text-[10px] text-slate-500 m-0">
                        {formatBytes(a.sizeBytes)} ·{" "}
                        {formatDate(a.uploadedAt)} · {a.mimeType}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={src}
                        download={a.filename}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700 no-underline"
                      >
                        Download
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDelete(a.id, a.filename)}
                        disabled={deletingId === a.id}
                        className="text-xs font-medium text-red-600 hover:text-red-700 bg-transparent border-0 cursor-pointer disabled:opacity-40 inline-flex items-center gap-1"
                      >
                        {deletingId === a.id && (
                          <Spinner size={10} color="currentColor" />
                        )}
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="p-3">
                    {isImageMime(a.mimeType) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={src}
                        alt={a.filename}
                        className="max-w-full max-h-[60vh] mx-auto block rounded"
                      />
                    ) : isPdfMime(a.mimeType) ? (
                      // PDF embed. Safari's <embed> handles PDFs
                      // reliably; the fallback download link below
                      // covers browsers without a built-in viewer.
                      <embed
                        src={src}
                        type="application/pdf"
                        width="100%"
                        height="500"
                        className="rounded"
                      />
                    ) : (
                      <p className="text-sm text-slate-500 italic text-center py-8">
                        Preview not available for this file type. Use the
                        Download link above.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex justify-end mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={deletingId !== null}
            className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
