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

import { useCallback, useEffect, useState } from "react";
import ConfirmModal from "./ConfirmModal";
import Spinner from "./Spinner";

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

            {/* Backfill state — surfaces only when backfill has started.
                Richer rendering (progress bar, paid-upgrade prompt)
                lands in sub-phase 8c. */}
            {state.backfill?.startedAt && !state.backfill?.completedAt && (
              <div className="bg-blue-50 border border-blue-200 text-blue-900 px-3 py-2 rounded text-xs">
                Backfilling orders… {state.backfill.ordersImported} imported so far.
              </div>
            )}
            {state.backfill?.cappedAt30k &&
              !state.backfill?.extendedPaidAt && (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 rounded text-xs">
                  Your store has more than 30,000 orders — we imported the
                  most recent 30k for free. (Paid upgrade UI lands in
                  sub-phase 8c.)
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
