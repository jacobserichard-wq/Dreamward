// app/components/ShopifyConnectionCard.tsx
//
// Phase 8b commit 2 of 3.
//
// Pure-presentational card showing the user's Shopify connection
// state. Owns its own data fetch (calls /api/shopify/connection
// on mount + after every connect/disconnect mutation) so the
// parent /integrations page stays a simple orchestrator.
//
// Renders one of four states:
//   - loading        — initial fetch in flight
//   - disconnected   — no connection; shows shop-name input + Connect button
//   - connecting     — Connect clicked; redirecting to Shopify (briefly visible)
//   - connected      — shows shop domain + connected-since date + Disconnect button
//                      + (placeholder for sync state / backfill progress)
//
// Connect flow:
//   1. User types shop name (e.g., "my-store" or "my-store.myshopify.com")
//   2. POST /api/shopify/oauth/initiate → { authorizeUrl }
//   3. window.location = authorizeUrl (full-page redirect to Shopify)
//   4. Shopify redirects back to /api/shopify/oauth/callback
//   5. Callback persists encrypted token, redirects to
//      /integrations?connected=1&shop=<domain>
//   6. /integrations page surfaces a success toast (next commit)
//
// Disconnect flow:
//   1. User clicks Disconnect → ConfirmModal opens
//   2. POST /api/shopify/disconnect → 200
//   3. Component re-fetches connection state → renders disconnected card

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ConfirmModal from "./ConfirmModal";
import Spinner from "./Spinner";

// Backfill polling cadence — how often the card re-fetches state
// while a backfill is running. 5s is a good balance: responsive
// enough to feel live, not so fast it hammers the API.
const BACKFILL_POLL_INTERVAL_MS = 5_000;

interface ConnectionState {
  connected: boolean;
  shopDomain?: string;
  scopes?: string[];
  connectedAt?: string;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncError?: string | null;
  backfill?: {
    startedAt: string | null;
    completedAt: string | null;
    totalOrders: number | null;
    ordersImported: number;
    cappedAt30k: boolean;
    extendedPaidAt: string | null;
  };
}

export default function ShopifyConnectionCard() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ConnectionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Connect-modal state
  const [shopInput, setShopInput] = useState("");
  const [connecting, setConnecting] = useState(false);

  // Disconnect-modal state
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Phase 8c: backfill state. backfillBusy is true while a POST to
  // /api/shopify/backfill is in flight (whether triggered by the
  // poll or by the user via the upgrade flow).
  const [backfillBusy, setBackfillBusy] = useState(false);

  const loadState = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/shopify/connection");
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

  // ── Phase 8c: backfill polling + chunk re-trigger ─────────────
  //
  // While the backfill is in-progress (started but not completed),
  // poll /api/shopify/connection every 5s to surface progress, and
  // re-POST /api/shopify/backfill whenever the previous chunk's
  // run finished but the backfill isn't complete yet. The route is
  // designed to be re-called safely (resumes from MAX(source_ref_id)).
  //
  // We use a ref to guard against overlapping POSTs — if a backfill
  // chunk takes longer than the poll interval, the next poll might
  // try to fire another. backfillBusyRef enforces "one in flight at
  // a time".
  const backfillBusyRef = useRef(false);
  useEffect(() => {
    if (!state?.connected) return;
    const bf = state.backfill;
    if (!bf) return;
    // Already done OR not yet started — no polling needed
    if (bf.completedAt) return;
    if (!bf.startedAt) return;
    // Capped at 30k without paid extension — stop; user must pay
    if (bf.cappedAt30k && !bf.extendedPaidAt) return;

    const tick = async () => {
      // Re-trigger a chunk if not currently in flight
      if (!backfillBusyRef.current) {
        backfillBusyRef.current = true;
        setBackfillBusy(true);
        try {
          await fetch("/api/shopify/backfill", { method: "POST" });
        } catch {
          // ignore — the next poll will retry
        } finally {
          backfillBusyRef.current = false;
          setBackfillBusy(false);
        }
      }
      // Refresh state so the UI reflects progress
      await loadState();
    };

    // Fire one immediately so connect → land on /integrations doesn't
    // wait 5s before showing progress; then interval after.
    void tick();
    const id = window.setInterval(tick, BACKFILL_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [
    state?.connected,
    state?.backfill?.completedAt,
    state?.backfill?.startedAt,
    state?.backfill?.cappedAt30k,
    state?.backfill?.extendedPaidAt,
    loadState,
  ]);

  const handleConnect = useCallback(async () => {
    if (!shopInput.trim()) {
      setError("Enter your Shopify store name (e.g., my-store)");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/shopify/oauth/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopDomain: shopInput.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        authorizeUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.authorizeUrl) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Full-page redirect to Shopify consent. The OAuth cookie was
      // set by the initiate route; the callback will land back on
      // /integrations and re-trigger the card's loadState.
      window.location.href = data.authorizeUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connect failed");
      setConnecting(false);
    }
  }, [shopInput]);

  const handleConfirmDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/shopify/disconnect", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setConfirmDisconnect(false);
      await loadState(); // refresh — should flip to disconnected
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  }, [loadState]);

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-3">
        <Spinner size={16} color="#94a3b8" />
        <span className="text-sm text-slate-500">Loading Shopify status…</span>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        {/* Header — logo-ish + name */}
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">{"\u{1F6D2}"}</span>
            <div>
              <h3 className="text-base font-bold text-slate-900 m-0">Shopify</h3>
              <p className="text-xs text-slate-500 m-0">
                Auto-pull orders + revenue from your store
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
              <strong>{state.shopDomain}</strong>
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

            {/* Sync status — minimal in 8b; richer in 8c/8d */}
            {state.lastSyncAt && (
              <div className="text-xs text-slate-500">
                Last sync:{" "}
                {new Date(state.lastSyncAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                · {state.lastSyncStatus ?? "unknown"}
              </div>
            )}

            {/* Phase 8c: backfill progress UI. Four conditional states:
                - in-progress (started but not completed, not capped) →
                  progress bar + count + "live" pulse
                - capped at 30k without paid extension → amber upgrade prompt
                - completed → small green "Imported N orders" line
                - never started → nothing (shouldn't happen post-connect) */}
            {state.backfill?.startedAt &&
              !state.backfill?.completedAt &&
              !(state.backfill.cappedAt30k && !state.backfill.extendedPaidAt) && (
                <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-blue-900 font-medium inline-flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                      Importing orders from Shopify…
                    </span>
                    <span className="text-blue-700 tabular-nums">
                      {state.backfill.ordersImported.toLocaleString()} imported
                      {backfillBusy && (
                        <span className="ml-1.5 text-blue-500">•</span>
                      )}
                    </span>
                  </div>
                  {/* Progress bar — indeterminate-style since we don't know
                      total order count until we hit the cap or end. Shows
                      a thin gradient stripe that animates. */}
                  <div className="w-full h-1 bg-blue-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 animate-pulse w-1/3" />
                  </div>
                  <p className="text-blue-700/80 mt-1.5 m-0">
                    Safe to leave this page — backfill continues in the
                    background.
                  </p>
                </div>
              )}

            {/* Capped at 30k cap, no paid extension yet → upgrade prompt */}
            {state.backfill?.cappedAt30k &&
              !state.backfill?.extendedPaidAt && (
                <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs">
                  <p className="font-semibold text-amber-900 m-0 mb-1">
                    {"\u{1F4E6}"} 30,000 orders imported (free cap)
                  </p>
                  <p className="text-amber-800 m-0 mb-3 leading-relaxed">
                    Your store has more orders than the 30,000-order free
                    backfill cap. Unlock unlimited backfill for a one-time
                    $99 fee — we&apos;ll import every remaining historical
                    order in the background.
                  </p>
                  <button
                    type="button"
                    disabled
                    title="Upgrade UI lands in commit 8c.4"
                    className="py-1.5 px-3 rounded bg-amber-600 text-white text-xs font-semibold cursor-not-allowed opacity-60 border-0"
                  >
                    Buy unlimited backfill — $99 (coming next commit)
                  </button>
                </div>
              )}

            {/* Completed → quiet confirmation line */}
            {state.backfill?.completedAt && state.backfill.ordersImported > 0 && (
              <div className="text-xs text-emerald-700 inline-flex items-center gap-1.5">
                <span>{"\u{2705}"}</span>
                <span>
                  Imported {state.backfill.ordersImported.toLocaleString()}{" "}
                  order{state.backfill.ordersImported === 1 ? "" : "s"} from
                  Shopify
                </span>
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
              <span className="text-xs text-slate-400">
                Disconnecting stops new syncs. Historical orders stay in your
                reports.
              </span>
            </div>
          </div>
        )}

        {/* Disconnected state — shop name input + Connect */}
        {!state?.connected && (
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div>
              <label
                htmlFor="shopify-shop-input"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Your Shopify store
              </label>
              <div className="flex gap-2 flex-wrap">
                <input
                  id="shopify-shop-input"
                  type="text"
                  value={shopInput}
                  onChange={(e) => {
                    setShopInput(e.target.value);
                    setError(null);
                  }}
                  placeholder="my-store"
                  className="flex-1 min-w-[200px] py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  disabled={connecting}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConnect();
                  }}
                />
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={connecting || !shopInput.trim()}
                  className="py-2 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold cursor-pointer border-0 disabled:opacity-60 disabled:cursor-wait inline-flex items-center gap-2"
                >
                  {connecting && <Spinner size={12} color="white" />}
                  {connecting ? "Redirecting…" : "Connect"}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1.5">
                Enter the part before <code>.myshopify.com</code>, or the full
                URL. You&apos;ll be redirected to Shopify to approve.
              </p>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmDisconnect}
        title="Disconnect Shopify?"
        message="This stops new orders from syncing. Your historical Shopify data stays in your reports. You can reconnect any time."
        confirmLabel="Disconnect"
        danger
        busy={disconnecting}
        onConfirm={handleConfirmDisconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </>
  );
}
