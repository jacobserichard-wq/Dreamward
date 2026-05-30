// app/components/ReimportLineItemsButton.tsx
//
// Phase 12g commit 3 of 4. Shared button + progress bar for the
// /api/{platform}/reimport-line-items endpoints. Mounted on each
// connection card (Shopify / Wix / Square) so merchants can
// retroactively populate line items for orders ingested before
// Phase 12c shipped.
//
// Behavior:
//   - Idle: shows "Re-import line items for COGS" button + a
//     subtitle explaining what it does.
//   - Running: shows progress bar (parents processed vs total),
//     a running tally of line items added, and a small spinner.
//     Self-polls + re-POSTs the endpoint until done=true.
//   - Done: shows a green chip "Up to date — X line items added."
//     The chip auto-fades after the user navigates away.
//
// Crafty Base context: their tool doesn't have a comparable
// retroactive recovery flow. New merchants who connect AFTER
// shipping a feature have to manually re-import everything.
// Our re-import is one-click + chunked + resumable.

"use client";

import { useCallback, useRef, useState } from "react";
import Spinner from "./Spinner";

type Platform = "shopify" | "wix" | "square";

interface ChunkResponse {
  done: boolean;
  processed: number;
  lineItemsAdded: number;
  cursor: number;
  totalRemaining: number;
}

export interface ReimportLineItemsButtonProps {
  platform: Platform;
  /** Display label for the platform (e.g., "Shopify orders"). */
  platformLabel: string;
}

export default function ReimportLineItemsButton({
  platform,
  platformLabel,
}: ReimportLineItemsButtonProps) {
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [processedTotal, setProcessedTotal] = useState(0);
  const [lineItemsTotal, setLineItemsTotal] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);

  // Used to derive an initial "total parents" estimate the first
  // time a chunk responds, so the progress bar has a denominator.
  const initialTotalRef = useRef<number | null>(null);

  const runChunk = useCallback(
    async (cursor: number): Promise<ChunkResponse> => {
      const url = new URL(
        `/api/${platform}/reimport-line-items`,
        window.location.origin
      );
      if (cursor > 0) url.searchParams.set("cursor", String(cursor));
      const res = await fetch(url.toString(), { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as ChunkResponse;
    },
    [platform]
  );

  const handleStart = useCallback(async () => {
    setPhase("running");
    setError(null);
    setProcessedTotal(0);
    setLineItemsTotal(0);
    setRemaining(null);
    initialTotalRef.current = null;

    let cursor = 0;
    try {
      // Loop chunks until done=true. The Vercel function time
      // budget inside the endpoint guarantees each call returns
      // within ~50s; the frontend just keeps invoking.
      while (true) {
        const result = await runChunk(cursor);
        cursor = result.cursor;
        setProcessedTotal((prev) => prev + result.processed);
        setLineItemsTotal((prev) => prev + result.lineItemsAdded);
        setRemaining(result.totalRemaining);
        if (initialTotalRef.current === null) {
          initialTotalRef.current =
            result.processed + result.totalRemaining;
        }
        if (result.done) {
          setPhase("done");
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-import failed");
      setPhase("idle");
    }
  }, [runChunk]);

  // ── Render ──────────────────────────────────────────────────
  if (phase === "done") {
    return (
      <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
        {"\u{2728}"} Up to date — {lineItemsTotal} line item
        {lineItemsTotal === 1 ? "" : "s"} added across {processedTotal} order
        {processedTotal === 1 ? "" : "s"}.
      </div>
    );
  }

  if (phase === "running") {
    const total = initialTotalRef.current ?? processedTotal;
    const pct =
      total > 0 ? Math.min(100, (processedTotal / total) * 100) : 0;
    return (
      <div className="mt-3 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-xs font-medium text-slate-700 inline-flex items-center gap-1.5">
            <Spinner size={10} color="currentColor" />
            Re-importing line items…
          </span>
          <span className="text-[10px] text-slate-500 tabular-nums">
            {processedTotal} of {total} orders · {lineItemsTotal} items
          </span>
        </div>
        <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  // idle
  return (
    <div className="mt-3">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-2 py-1 rounded text-xs mb-2">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={handleStart}
        className="text-xs font-medium text-blue-600 hover:text-blue-700 bg-transparent border-0 cursor-pointer inline-flex items-center gap-1"
        title={`Walk your historical ${platformLabel} and populate per-line-item COGS data.`}
      >
        {"\u{1F4E6}"} Re-import line items for COGS →
      </button>
      <p className="text-[10px] text-slate-400 m-0 mt-0.5">
        Catches up historical orders that were ingested before COGS
        tracking shipped. Chunked + safe to interrupt.
      </p>
    </div>
  );
}
