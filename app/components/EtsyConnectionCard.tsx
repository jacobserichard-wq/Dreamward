// app/components/EtsyConnectionCard.tsx
//
// Etsy integration commit 6. Fourth platform card on /integrations,
// after Shopify / Wix / Square. Three-state machine: loading /
// connected / disconnected.
//
// Two architectural differences from the Square card:
//   - Backfill is DRIVEN from here with a sequential chunk loop
//     (each POST /api/etsy/backfill runs up to ~50s and resumes from
//     backfill_cursor), not the 5s interval poller — the connection
//     endpoint only exposes a backfillDone boolean, so progress
//     counts accumulate client-side from the chunk responses.
//   - No "Live sync active" webhook indicator. Etsy v1 has no
//     webhooks; the daily cron reconciliation IS the ongoing sync,
//     and the card says so plainly instead of pretending otherwise.
//
// No ReimportLineItemsButton either: Etsy launched with line-item
// fanout from day one (backfill + cron both fan), so there is no
// pre-line-items era to recover, unlike Shopify/Wix/Square.

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ConfirmModal from "./ConfirmModal";
import Spinner from "./Spinner";
import ConnectRangeModal from "./ConnectRangeModal";

// Transient chunk failures retry after a pause; give up after this
// many consecutive failures so a dead connection doesn't loop forever.
const BACKFILL_MAX_CONSECUTIVE_FAILURES = 3;
const BACKFILL_RETRY_DELAY_MS = 5_000;

interface ConnectionState {
  connected: boolean;
  shopId?: string;
  shopName?: string | null;
  connectedAt?: string;
  backfillDone?: boolean;
}

export default function EtsyConnectionCard() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ConnectionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [connecting, setConnecting] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);

  // Client-side backfill progress, accumulated from chunk responses.
  // On a mid-backfill page reload the imported counter restarts at 0
  // but totalSeen resumes from the server-side cursor, so the user
  // still sees forward motion.
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillImported, setBackfillImported] = useState(0);
  const [backfillFinished, setBackfillFinished] = useState(false);

  const loadState = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/etsy/connection");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        setState(null);
        return;
      }
      const data = (await res.json()) as ConnectionState;
      setState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load");
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  // ── Backfill driver ───────────────────────────────────────────
  // While connected with backfill incomplete, run the chunk loop:
  // POST → await (up to ~50s server-side) → repeat until done=true.
  // The route resumes from backfill_cursor, so interruption (tab
  // close, deploy) is safe — the loop just picks up where it left
  // off on next mount.
  useEffect(() => {
    if (!state?.connected || state.backfillDone !== false) return;
    let cancelled = false;
    setBackfillRunning(true);

    (async () => {
      let failures = 0;
      try {
        for (;;) {
          if (cancelled) return;
          let data: {
            done?: boolean;
            receiptsImported?: number;
            error?: string;
          };
          try {
            const res = await fetch("/api/etsy/backfill", {
              method: "POST",
            });
            data = await res.json().catch(() => ({}));
            if (!res.ok) {
              throw new Error(data.error || `HTTP ${res.status}`);
            }
          } catch (err) {
            failures++;
            if (failures >= BACKFILL_MAX_CONSECUTIVE_FAILURES) {
              throw err;
            }
            await new Promise((r) =>
              setTimeout(r, BACKFILL_RETRY_DELAY_MS)
            );
            continue;
          }
          failures = 0;
          if (cancelled) return;
          setBackfillImported((n) => n + (data.receiptsImported ?? 0));
          if (data.done) break;
        }
        if (!cancelled) {
          setBackfillFinished(true);
          await loadState();
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? `Import paused: ${err.message} — reload this page to resume where it left off.`
              : "Import paused — reload this page to resume."
          );
        }
      } finally {
        if (!cancelled) setBackfillRunning(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state?.connected, state?.backfillDone, loadState]);

  const handleConnect = useCallback(async (importStartDate: string | null) => {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/etsy/oauth/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importStartDate }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        authorizeUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.authorizeUrl) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Full-page redirect — the state + PKCE verifier cookies were
      // set by the initiate route; the callback lands back here.
      window.location.href = data.authorizeUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connect failed");
      setConnecting(false);
    }
  }, []);

  const handleConfirmDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/etsy/disconnect", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setConfirmDisconnect(false);
      setBackfillImported(0);
      setBackfillFinished(false);
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  }, [loadState]);

  const handleConfirmPurge = useCallback(async () => {
    setPurging(true);
    setPurgeMsg(null);
    try {
      const res = await fetch("/api/etsy/purge-data", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        deleted?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const count = data.deleted ?? 0;
      setPurgeMsg(
        count > 0
          ? `Deleted ${count.toLocaleString()} Etsy order${count === 1 ? "" : "s"} from your reports.`
          : "No Etsy orders to delete."
      );
      setConfirmPurge(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete data");
    } finally {
      setPurging(false);
    }
  }, []);

  const displayLabel = (() => {
    if (state?.shopName) return state.shopName;
    if (state?.shopId) return `Shop ${state.shopId}`;
    return "Connected shop";
  })();

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-3">
        <Spinner size={16} color="#94a3b8" />
        <span className="text-sm text-slate-500">Loading Etsy status…</span>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">{"\u{1F3F7}\u{FE0F}"}</span>
            <div>
              <h3 className="text-base font-bold text-slate-900 m-0">Etsy</h3>
              <p className="text-xs text-slate-500 m-0">
                Sync shop orders + per-listing line items
              </p>
            </div>
          </div>
          {state?.connected ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              Not connected
            </span>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-xs">
            {error}
          </div>
        )}

        {/* Connected state */}
        {state?.connected && (
          <div className="space-y-3">
            <div className="text-sm text-slate-700">
              <strong>{displayLabel}</strong>
              {state.connectedAt && (
                <span className="text-slate-500">
                  {" "}
                  · connected{" "}
                  {new Date(state.connectedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              )}
            </div>

            {/* Sync cadence — honest about how Etsy syncs. */}
            {state.backfillDone && (
              <div className="text-xs text-slate-500 inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                New orders sync automatically once a day. Etsy
                doesn&apos;t offer instant webhooks, so Dreamward
                reconciles your shop every morning.
              </div>
            )}

            {/* Backfill progress — driven by the chunk loop above */}
            {backfillRunning && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-blue-900 font-medium inline-flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                    Importing your Etsy order history…
                  </span>
                  <span className="text-blue-700 tabular-nums">
                    {backfillImported.toLocaleString()} imported
                  </span>
                </div>
                <div className="w-full h-1 bg-blue-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 animate-pulse w-1/3" />
                </div>
                <p className="text-blue-700/80 mt-1.5 m-0">
                  Keep this page open until the import finishes — if you
                  leave, it resumes from the same spot next visit.
                </p>
              </div>
            )}
            {backfillFinished && (
              <div className="text-xs text-emerald-700 inline-flex items-center gap-1.5">
                <span>{"\u{2705}"}</span>
                <span>
                  Imported {backfillImported.toLocaleString()} order
                  {backfillImported === 1 ? "" : "s"} from Etsy
                </span>
              </div>
            )}

            {/* Catalog-pull cross-link — listings become SKUs +
                aliases, lighting up per-product COGS. */}
            {state.backfillDone && (
              <div className="text-xs text-slate-600">
                Next step:{" "}
                <Link
                  href="/skus/bulk-import"
                  className="text-blue-600 hover:underline"
                >
                  import your Etsy listings as SKUs
                </Link>{" "}
                so every sale maps to per-product cost automatically.
              </div>
            )}

            {purgeMsg && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded-lg text-xs flex justify-between items-center gap-3 flex-wrap">
                <span className="font-medium">
                  {"\u{2705}"} {purgeMsg}
                </span>
                <button
                  type="button"
                  onClick={() => setPurgeMsg(null)}
                  className="text-emerald-700 hover:underline cursor-pointer text-xs bg-transparent border-0"
                >
                  Dismiss
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmDisconnect(true)}
                className="py-1.5 px-3 rounded border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Disconnect
              </button>
              <button
                type="button"
                onClick={() => setConfirmPurge(true)}
                className="py-1.5 px-3 rounded border border-red-200 bg-white text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer"
              >
                Delete all Etsy data
              </button>
              <span className="text-xs text-slate-400">
                Disconnect stops new syncs. Delete removes imported
                orders from your reports too.
              </span>
            </div>
          </div>
        )}

        {/* Disconnected state */}
        {!state?.connected && (
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="flex gap-2 flex-wrap items-center">
              <button
                type="button"
                onClick={() => setShowConnectModal(true)}
                disabled={connecting}
                className="py-2 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold cursor-pointer border-0 disabled:opacity-60 disabled:cursor-wait inline-flex items-center gap-2"
              >
                {connecting && <Spinner size={12} color="white" />}
                {connecting ? "Redirecting…" : "Connect Etsy shop"}
              </button>
              <span className="text-xs text-slate-500">
                You&apos;ll sign into Etsy and approve read-only access
                to your shop&apos;s orders and listings.
              </span>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmDisconnect}
        title="Disconnect Etsy?"
        message="This stops new orders from syncing. Your historical Etsy data stays in your reports, and you can reconnect any time. To fully revoke Dreamward's access on Etsy's side too, visit Etsy → Account settings → Privacy → Apps."
        confirmLabel="Disconnect"
        danger
        busy={disconnecting}
        onConfirm={handleConfirmDisconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />

      <ConfirmModal
        open={confirmPurge}
        title="Delete all Etsy data?"
        message="This permanently removes every order imported from Etsy from your Dreamward reports. This cannot be undone. Your Etsy connection stays active — disconnect separately if you want to stop syncing too."
        confirmLabel="Delete all Etsy data"
        danger
        busy={purging}
        onConfirm={handleConfirmPurge}
        onCancel={() => setConfirmPurge(false)}
      />

      <ConnectRangeModal
        open={showConnectModal}
        providerName="Etsy"
        onContinue={(d) => {
          setShowConnectModal(false);
          handleConnect(d);
        }}
        onCancel={() => setShowConnectModal(false)}
      />
    </>
  );
}
