// Phase 6.5 commit 7 of 8. Modal triggered from /invoices that
// drives the POST /api/invoices/ingest endpoint (commit 3).
//
// Three inputs: label (default SENT), date filter (default 30 days
// ago), max results (default 50, hard cap 100). On submit, shows
// loading spinner, then a result summary {fetched, prefiltered,
// inserted, skipped, errors}. Parent reloads the list when results
// land so the new needs_review rows show up immediately.
//
// Pure-presentational + a small useState for the form fields. Parent
// owns open/close + the actual fetch.

"use client";

import { useState } from "react";

interface IngestResult {
  fetched: number;
  prefiltered: number;
  inserted: number;
  skipped: number;
  errors: number;
}

interface FetchFromGmailModalProps {
  open: boolean;
  onClose: () => void;
  /** Fetch handler. Parent does the fetch + list refresh; this just
   *  resolves with the API response so the modal can show a summary. */
  onFetch: (opts: {
    label: string;
    after: string;
    maxResults: number;
  }) => Promise<IngestResult>;
}

// Helper: YYYY-MM-DD for N days ago, used as the date-input default.
function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function FetchFromGmailModal({
  open,
  onClose,
  onFetch,
}: FetchFromGmailModalProps) {
  const [label, setLabel] = useState<string>("SENT");
  const [after, setAfter] = useState<string>(daysAgoIso(30));
  const [maxResults, setMaxResults] = useState<number>(50);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await onFetch({
        label: label.trim() || "SENT",
        after,
        maxResults,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    if (busy) return; // don't close mid-fetch
    setResult(null);
    setError(null);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fetch-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={handleClose}
    >
      <div
        // Stop click-through on the modal body.
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
      >
        <div className="flex justify-between items-start mb-4">
          <h2
            id="fetch-modal-title"
            className="text-lg font-bold text-slate-900 m-0"
          >
            Fetch invoices from Gmail
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600 disabled:opacity-40 cursor-pointer text-xl leading-none"
          >
            {"×"}
          </button>
        </div>

        <p className="text-sm text-slate-500 mb-5 m-0">
          Scans a Gmail label for invoice emails and creates a row
          for each one. Use <strong>SENT</strong> for invoices you
          emailed to customers, or set up a <strong>Dreamward-AR</strong>
          {" "}label in Gmail to manually curate.
        </p>

        {/* Results panel — replaces the form after a successful fetch. */}
        {result && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-3 mb-4 text-sm">
            <p className="font-medium m-0 mb-1">Fetch complete</p>
            <ul className="m-0 pl-4 list-disc text-xs space-y-0.5">
              <li>{result.fetched} emails fetched</li>
              <li>{result.prefiltered} matched invoice keywords</li>
              <li>
                <strong>{result.inserted}</strong> new invoice rows
                created (review queue)
              </li>
              <li>{result.skipped} skipped (duplicate or incomplete)</li>
              {result.errors > 0 && (
                <li className="text-red-700">
                  {result.errors} errors (see server logs)
                </li>
              )}
            </ul>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 mb-4 text-sm">
            {error}
          </div>
        )}

        {!result && (
          <>
            <div className="mb-3">
              <label
                htmlFor="fetch-label"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Gmail label
              </label>
              <input
                id="fetch-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="SENT"
                disabled={busy}
                className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-100"
              />
              <p className="text-xs text-slate-500 mt-1 m-0">
                System labels (SENT, INBOX) or any label you&apos;ve
                created.
              </p>
            </div>

            <div className="mb-3">
              <label
                htmlFor="fetch-after"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Only emails after
              </label>
              <input
                id="fetch-after"
                type="date"
                value={after}
                onChange={(e) => setAfter(e.target.value)}
                disabled={busy}
                className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-100"
              />
            </div>

            <div className="mb-4">
              <label
                htmlFor="fetch-max"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Max emails to scan
              </label>
              <input
                id="fetch-max"
                type="number"
                min={1}
                max={100}
                value={maxResults}
                onChange={(e) =>
                  setMaxResults(
                    Math.max(
                      1,
                      Math.min(100, Math.floor(Number(e.target.value) || 50))
                    )
                  )
                }
                disabled={busy}
                className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-100"
              />
              <p className="text-xs text-slate-500 mt-1 m-0">
                Hard cap 100. Costs roughly $0.01 per email run
                through the extractor.
              </p>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="py-2 px-4 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer disabled:opacity-40"
          >
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy}
              className={`py-2 px-4 text-sm font-semibold text-white rounded-lg border-0 cursor-pointer ${
                busy ? "bg-slate-400" : "bg-blue-500"
              }`}
            >
              {busy ? "Fetching..." : "Fetch now"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
