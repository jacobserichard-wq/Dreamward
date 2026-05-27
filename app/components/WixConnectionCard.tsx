// app/components/WixConnectionCard.tsx
//
// Phase 10 Client Credentials rewrite. The Wix connection card on
// /integrations. Three-state machine: loading / disconnected /
// connected.
//
// ─────────────────────────────────────────────────────────────────
// Why the Connect flow looks unlike Shopify (or any other OAuth):
// ─────────────────────────────────────────────────────────────────
// Wix's modern install pattern (Client Credentials, post-2025
// platform changes) means there is no "we redirect the user to a
// vendor consent screen" flow we control. Installation happens
// on Wix's side — merchant clicks an install link, Wix shows the
// consent screen with our pre-configured permissions, merchant
// approves, and Wix then sends them BACK to FlowWork via the
// post-install redirect endpoint (/api/wix/installed/redirect)
// which does the actual binding of client_id ↔ instance_id.
//
// So this card's Connect UX is just "click here to start the
// install flow on Wix" — opens the install URL in a new tab so
// the merchant doesn't lose their FlowWork session. While the
// tab is open, we poll /api/wix/connection every few seconds so
// when the merchant lands back here we re-render as Connected
// without requiring a manual page refresh.
//
// Disconnected state polling:
//   Cadence 5s, only while disconnected + the card is mounted.
//   Stops as soon as state flips to connected. Cheap call against
//   our own backend; no Wix-side rate-limit exposure.
//
// Connection state shape: matches the response of GET
// /api/wix/connection after the Phase 10 commit-6 refactor —
// no token expiry, no scopes-based warnings, just identity +
// install timestamp + sync state.

"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmModal from "./ConfirmModal";
import Spinner from "./Spinner";

// While disconnected, re-fetch connection state every 5s to catch
// the merchant's return from the install flow without requiring a
// page refresh. Cheap (one DB query against our own backend).
const DISCONNECTED_POLL_INTERVAL_MS = 5_000;

// Install URL. Configured per-deployment via NEXT_PUBLIC_WIX_INSTALL_URL
// since the share link / App Market listing URL is Wix-side state
// that changes between dev/prod and over time. The fallback below
// is Jacob's current "Share Install Link" from Wix Dev Center —
// intentionally flagged in console.warn so misconfiguration is
// visible (per the no-silent-fallbacks repo convention).
function getInstallUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_WIX_INSTALL_URL;
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined") {
    console.warn(
      "NEXT_PUBLIC_WIX_INSTALL_URL not set — falling back to the " +
        "Phase 10 dev-time share install link. Set the env var in " +
        "Vercel for prod."
    );
  }
  return "https://wix.to/MxdvZVA";
}

interface ConnectionState {
  connected: boolean;
  instanceId?: string;
  siteDisplayName?: string | null;
  scopes?: string[];
  connectedAt?: string;
  installedAt?: string;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncError?: string | null;
  /** Number of registered Wix webhook subscriptions. Always 0 for
   *  Phase 10b — subscription wiring lands in 10d. */
  webhookCount?: number;
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

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Manual-bind state. Wix's App Installed webhook doesn't fire for
  // share-install-link installs (only for App Market installs we
  // haven't shipped yet), so this is the path most merchants will
  // use until/unless we go through App Market submission.
  const [manualInstanceId, setManualInstanceId] = useState("");
  const [binding, setBinding] = useState(false);

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

  // ── Disconnected-state polling ────────────────────────────────
  // While disconnected, poll every 5s so the merchant returning
  // from the install flow (which happens in a different tab) sees
  // the card flip to Connected without needing to refresh. Stops
  // as soon as state.connected becomes true.
  useEffect(() => {
    if (loading) return;
    if (state?.connected) return;
    const id = window.setInterval(loadState, DISCONNECTED_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [loading, state?.connected, loadState]);

  const handleConnect = useCallback(() => {
    // Open the Wix install flow in a new tab. The merchant picks
    // their site + approves permissions on Wix, then Wix redirects
    // their browser to /api/wix/installed/redirect which does the
    // binding. This card's polling loop catches the state flip.
    window.open(getInstallUrl(), "_blank", "noopener,noreferrer");
  }, []);

  const handleManualBind = useCallback(async () => {
    const trimmed = manualInstanceId.trim();
    if (!trimmed) {
      setError("Paste your Wix instance ID first.");
      return;
    }
    setBinding(true);
    setError(null);
    try {
      const res = await fetch("/api/wix/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        bound?: boolean;
        error?: string;
      };
      if (!res.ok || !data.bound) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setManualInstanceId("");
      await loadState(); // refresh — should flip to connected
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect");
    } finally {
      setBinding(false);
    }
  }, [manualInstanceId, loadState]);

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
  // siteDisplayName comes from a separate Sites API call during
  // the install bind step and can be null if Wix's API failed
  // (rare). Fall back to a truncated instance UUID so the user
  // still has *something* to identify by.
  const displayLabel = (() => {
    if (state?.siteDisplayName) return state.siteDisplayName;
    if (state?.instanceId) return `Site ${state.instanceId.slice(0, 8)}…`;
    return "Connected site";
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
              {state.installedAt && (
                <span className="text-slate-500">
                  {" "}
                  · installed{" "}
                  {new Date(state.installedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              )}
            </div>

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
                on whatever the connection endpoint returns. */}
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

        {/* Disconnected state — install-on-Wix CTA + brief
            instructions. Unlike Shopify (where we control the OAuth
            redirect), Wix runs the install flow on their side. We
            send the merchant there in a new tab and poll for the
            return. */}
        {!state?.connected && (
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div>
              <p className="text-xs text-slate-600 mb-2.5 leading-relaxed">
                Click below to install FlowWork on your Wix site. You&apos;ll
                pick the site, approve permissions, and then Wix will send
                you back here automatically.
              </p>
              <div className="flex gap-2 flex-wrap items-center">
                <button
                  type="button"
                  onClick={handleConnect}
                  className="py-2 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold cursor-pointer border-0 inline-flex items-center gap-2"
                >
                  Install on your Wix site →
                </button>
                <span className="text-xs text-slate-500 inline-flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-slate-300" />
                  Watching for connection…
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                The install opens in a new tab. Keep this tab open — it
                refreshes automatically when the connection completes.
              </p>
            </div>

            {/* Manual-bind fallback. Wix's auto-detect doesn't fire
                for installs done via Share Install Link (only App
                Market installs), so most merchants will land here
                until we go through App Market submission. */}
            <div className="pt-3 border-t border-dashed border-slate-200">
              <details className="group">
                <summary className="text-xs font-medium text-slate-700 cursor-pointer hover:text-slate-900 select-none list-none">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-slate-400 group-open:rotate-90 transition-transform inline-block">
                      ▸
                    </span>
                    Already installed? Connect manually
                  </span>
                </summary>
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    If you already installed FlowWork on a Wix site and the
                    automatic connection didn&apos;t happen, paste your{" "}
                    <strong>Wix App Instance ID</strong> below. Find it in
                    your Wix dashboard:{" "}
                    <a
                      href="https://manage.wix.com/account/sites"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      Wix Sites
                    </a>{" "}
                    → click your site → <em>Manage Apps</em> → click
                    FlowWork → the UUID in the URL or app details.
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <input
                      type="text"
                      value={manualInstanceId}
                      onChange={(e) => {
                        setManualInstanceId(e.target.value);
                        setError(null);
                      }}
                      placeholder="12345678-1234-1234-1234-123456789012"
                      className="flex-1 min-w-[280px] py-2 px-3 text-xs font-mono border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      disabled={binding}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleManualBind();
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleManualBind}
                      disabled={binding || !manualInstanceId.trim()}
                      className="py-2 px-4 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer border-0 disabled:opacity-60 disabled:cursor-wait inline-flex items-center gap-2"
                    >
                      {binding && <Spinner size={11} color="white" />}
                      {binding ? "Connecting…" : "Connect"}
                    </button>
                  </div>
                </div>
              </details>
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
