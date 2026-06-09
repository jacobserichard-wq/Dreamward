// app/components/ProductionSection.tsx
//
// Tier 2 commit 5. Production runs on the SKU detail page — the
// "+ Log production run" action + run history with reverse.
// Self-contained: fetches its own run history. Calls onChanged
// after a run is logged or reversed so the parent can refresh the
// finished-stock + recipe sections (their numbers just moved).

"use client";

import { useCallback, useEffect, useState } from "react";
import Spinner from "./Spinner";
import LogProductionModal from "./LogProductionModal";

interface ProductionRunRow {
  id: number;
  quantityProduced: number;
  runDate: string;
  notes: string | null;
  createdAt: string;
}

export interface ProductionSectionProps {
  skuId: number;
  skuCode: string;
  skuName: string;
  /** Fired after a run is logged or reversed (stock changed). */
  onChanged: () => void;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export default function ProductionSection({
  skuId,
  skuCode,
  skuName,
  onChanged,
}: ProductionSectionProps) {
  const [runs, setRuns] = useState<ProductionRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [reversingId, setReversingId] = useState<number | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch(`/api/production-runs?sku=${skuId}&limit=50`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { runs: ProductionRunRow[] };
      setRuns(data.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load runs");
    } finally {
      setLoading(false);
    }
  }, [skuId]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const handleReverse = async (runId: number) => {
    if (
      !window.confirm(
        "Reverse this production run? It credits the materials back and removes the finished stock it added."
      )
    ) {
      return;
    }
    setReversingId(runId);
    try {
      const res = await fetch(`/api/production-runs/${runId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      await loadRuns();
      onChanged();
    } finally {
      setReversingId(null);
    }
  };

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-slate-900 m-0">
          Production
        </h2>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="py-1.5 px-3 text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer"
        >
          + Log production run
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {error && (
          <div className="bg-red-50 border-b border-red-200 text-red-800 px-4 py-2 text-sm">
            {error}
          </div>
        )}
        {loading ? (
          <div className="p-6 text-center text-slate-400 text-sm">
            Loading...
          </div>
        ) : runs.length === 0 ? (
          <div className="px-4 py-5 text-sm text-slate-500">
            No production runs yet. Log one when you make a batch — it adds
            finished stock and draws down the recipe&apos;s materials.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="text-left py-2.5 px-4 font-medium">Date</th>
                <th className="text-right py-2.5 px-4 font-medium">Produced</th>
                <th className="text-left py-2.5 px-4 font-medium">Notes</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                    {fmtDate(r.runDate)}
                  </td>
                  <td className="py-2.5 px-4 text-right tabular-nums text-emerald-700 font-semibold whitespace-nowrap">
                    +{r.quantityProduced.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4 text-slate-500 text-xs">
                    {r.notes ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleReverse(r.id)}
                      disabled={reversingId === r.id}
                      title="Reverse this run"
                      className="text-xs text-slate-400 hover:text-red-600 cursor-pointer bg-transparent border-0 disabled:cursor-wait inline-flex items-center gap-1"
                    >
                      {reversingId === r.id && (
                        <Spinner size={10} color="#94a3b8" />
                      )}
                      Reverse
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <LogProductionModal
        open={modalOpen}
        skuId={skuId}
        skuCode={skuCode}
        skuName={skuName}
        onClose={() => setModalOpen(false)}
        onLogged={() => {
          void loadRuns();
          onChanged();
        }}
      />
    </section>
  );
}
