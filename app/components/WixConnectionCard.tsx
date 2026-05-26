// app/components/WixConnectionCard.tsx
//
// Phase 10b commit 2. Wix counterpart to ShopifyConnectionCard.
// Same loading / connected / disconnected state machine; differences
// noted below.
//
// Differences vs Shopify:
//   - No shop-domain input. The Wix consent screen lets the merchant
//     pick which Wix site they're installing on, so /api/wix/oauth/
//     initiate takes no body. Connect = single button click.
//   - Renders siteDisplayName (best-effort) instead of shopDomain.
//     siteDisplayName can be null if the Sites API call failed at
//     connect time — falls back to a truncated instance UUID.
//   - Backfill UI omitted (Phase 10c). Wix doesn't have Shopify's
//     30k cap / paid extension concept either, so when the backfill
//     ships in 10c the progress UI will be simpler than Shopify's.
//   - accessTokenExpiresAt is surfaced as a "needs reconnect" warning
//     when the cached expiry is past + the last refresh failed. Wix
//     access tokens are short-lived (~5 min) — refresh happens on
//     every API call in lib/wix.ts, so a past expiry means the
//     refresh chain is broken (rare; only when the merchant
//     uninstalls the app on their Wix site).
//
// Connect flow:
//   1. User clicks Connect
//   2. POST /api/wix/oauth/initiate → { authorizeUrl }
//   3. window.location = authorizeUrl (full-page redirect to Wix)
//   4. Wix redirects back to /api/wix/oauth/callback with code + state
//   5. Callback persists encrypted tokens, redirects to
//      /integrations?connected_wix=1&site=<name>
//   6. /integrations page surfaces a success toast (commit 3)
//
// Disconnect flow:
//   1. User clicks Disconnect → ConfirmModal opens
//   2. POST /api/wix/disconnect → 200
//   3. Component re-fetches connection state → renders disconnected card

"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmModal from "./ConfirmModal";
import Spinner from "./Spinner";

interface ConnectionState {
  connected: boolean;
  instanceId?: string;
  siteDisplayName?: string | null;
  scopes?: string[];
  connectedAt?: string;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncError?: string | null;
  /** Number of registered Wix webhook subscriptions. Non-zero means
   *  real-time sync is active; zero means degraded mode (data still
   *  flows via daily cron once Phase 10e ships). For 10a/10b this is
   *  always 0 — webhook registration lands in 10d. */
  webhookCount?: number;
  /** ISO string for the cached access_token expiry. Past expiry
   *  means the refresh chain broke (merchant uninstalled app, Wix
   *  revoked, etc.) — render the reconnect warning. */
  accessTokenExpiresAt?: string | null;
  backfill?: {
    startedAt: string | null;
    completedAt: string | null;
    totalOrders: number | null;
    ordersImported: number;
  };
}

export default function WixConnectionCard() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ConnectionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadState = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/wix/connection");
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
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/wix/oauth/initiate", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        authorizeUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.authorizeUrl) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Full-page redirect to Wix consent. The state cookie was set by
      // the initiate route; the callback will land back on /integrations
      // and re-trigger this card's loadState.
      window.location.href = data.authorizeUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connect failed");
      setConnecting(false);
    }
  }, []);

  const handleConfirmDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/wix/disconnect", { method: "POST" });
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

  // Best-effort display label for the connected site. Wix's
  // siteDisplayName comes from a separate Sites API call at connect
  // time and can be null. Fall back to a truncated instance UUID
  // (`Site abc12345…`) so the user has *something* to identify by.
  const displayLabel = (() => {
    if (state?.siteDisplayName) return state.siteDisplayName;
    if (state?.instanceId) return `Site ${state.instanceId.slice(0, 8)}…`;
    return "Connected site";
  })();

  // Reconnect warning: token expiry in the past = refresh chain broken.
  const tokenExpired = (() => {
    if (!state?.connected || !state.accessTokenExpiresAt) return false;
    return new Date(state.accessTokenExpiresAt).getTime() < Date.now();
  })();

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-3">
        <Spinner size={16} color="#94a3b8" />
        <span className="text-sm text-slate-500">Loading Wix status…</span>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        {/* Header — logo-ish + name */}
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">{"\u{1F310}"}</span>
            <div>
              <h3 className="text-base font-bold text-slate-900 m-0">Wix</h3>
              <p className="text-xs text-slate-500 m-0">
                Auto-pull orders + revenue from your Wix site
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

            {/* Reconnect warning if the cached token expired and refresh
                chain is broken. Rare — happens if the merchant
                uninstalls the app from inside Wix. */}
            {tokenExpired && (
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs">
                <p className="font-semibold text-amber-900 m-0 mb-1">
                  {"\u{26A0}\u{FE0F}"} Connection needs refresh
                </p>
                <p className="text-amber-800 m-0 leading-relaxed">
                  The connection to Wix expired. This usually means the
                  app was uninstalled on your Wix site. Disconnect and
                  reconnect to restore syncing.
                </p>
              </div>
            )}

            {/* Sync status — last_sync_at + live-sync indicator (10d) */}
            <div className="flex items-center gap-3 flex-wrap text-xs">
              {typeof state.webhookCount === "number" && (
                <span
                  className={`inline-flex items-center gap-1.5 font-medium ${
                    state.webhookCount > 0
                      ? "text-emerald-700"
                      : "text-amber-700"
                  }`}
                  title={
                    state.webhookCount > 0
                      ? `${state.webhookCount} webhook subscription${state.webhookCount === 1 ? "" : "s"} active — new orders sync within seconds`
                      : "Webhooks not registered yet — new orders sync via daily reconciliation once Phase 10e ships"
                  }
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      state.webhookCount > 0
                        ? "bg-emerald-500"
                        : "bg-amber-500"
                    }`}
                  />
                  {state.webhookCount > 0
                    ? "Live sync active"
                    : "Webhooks pending"}
                </span>
              )}
              {state.lastSyncAt && (
                <span className="text-slate-500">
                  Last sync:{" "}
                  {new Date(state.lastSyncAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </div>

            {/* Backfill progress — Phase 10c will wire this up. Until
                then we render a minimal completed-or-pending hint based
                on whatever the connection endpoint returns (defaults
                to 0 orders, null timestamps for fresh connects). */}
            {state.backfill?.startedAt && !state.backfill?.completedAt && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-blue-900 font-medium inline-flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                    Importing orders from Wix…
                  </span>
                  <span className="text-blue-700 tabular-nums">
                    {state.backfill.ordersImported.toLocaleString()} imported
                  </span>
                </div>
              </div>
            )}
            {state.backfill?.completedAt &&
              state.backfill.ordersImported > 0 && (
                <div className="text-xs text-emerald-700 inline-flex items-center gap-1.5">
                  <span>{"\u{2705}"}</span>
                  <span>
                    Imported{" "}
                    {state.backfill.ordersImported.toLocaleString()} order
                    {state.backfill.ordersImported === 1 ? "" : "s"} from Wix
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

        {/* Disconnected state — single Connect button. Unlike Shopify,
            no shop-name input is needed; the Wix consent screen lets
            the merchant pick which site to install on. */}
        {!state?.connected && (
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="flex gap-2 flex-wrap items-center">
              <button
                type="button"
                onClick={handleConnect}
                disabled={connecting}
                className="py-2 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold cursor-pointer border-0 disabled:opacity-60 disabled:cursor-wait inline-flex items-center gap-2"
              >
                {connecting && <Spinner size={12} color="white" />}
                {connecting ? "Redirecting…" : "Connect Wix site"}
              </button>
              <span className="text-xs text-slate-500">
                You&apos;ll pick which Wix site to connect on Wix&apos;s
                consent screen.
              </span>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmDisconnect}
        title="Disconnect Wix?"
        message="This stops new orders from syncing. Your historical Wix data stays in your reports. You can reconnect any time."
        confirmLabel="Disconnect"
        danger
        busy={disconnecting}
        onConfirm={handleConfirmDisconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </>
  );
}
