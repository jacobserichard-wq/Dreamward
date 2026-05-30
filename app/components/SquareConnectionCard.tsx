// app/components/SquareConnectionCard.tsx
//
// Phase 11b commit 1. Square counterpart to ShopifyConnectionCard
// and WixConnectionCard. Three-state machine: loading / connected /
// disconnected.
//
// Architecturally simpler than Wix:
//   - Standard OAuth redirect flow (no Dashboard Extension, no
//     manual UUID paste). Click Connect → opens Square consent in
//     same window → Square redirects back to /api/square/oauth/
//     callback → callback inserts row + redirects to
//     /integrations?connected_square=1&merchant=<name>
//   - No "Webhooks pending" indicator on initial connect — webhook
//     count flips from 0 → N as Phase 11d events arrive
//   - Environment badge ('Sandbox' / 'Production') so dev
//     installations are visually distinct from real ones
//   - Token-expiry warning when access_token_expires_at is within
//     7 days (the auto-refresh in lib/square should handle this
//     transparently, but if it ever fails the user has visibility)

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ConfirmModal from "./ConfirmModal";
import Spinner from "./Spinner";
import ReimportLineItemsButton from "./ReimportLineItemsButton";

// Phase 11c: while a backfill is in-progress, re-trigger the next
// chunk + refresh state every 5s. Mirrors WixConnectionCard.
const BACKFILL_POLL_INTERVAL_MS = 5_000;

interface ConnectionState {
  connected: boolean;
  merchantId?: string;
  businessName?: string | null;
  environment?: string;
  scopes?: string[];
  connectedAt?: string;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncError?: string | null;
  /** Count of distinct webhook event types we've received. Non-zero
   *  flips the indicator to "Live sync active". Phase 11d wires up
   *  the actual subscriptions. */
  webhookCount?: number;
  accessTokenExpiresAt?: string;
  backfill?: {
    startedAt: string | null;
    completedAt: string | null;
    paymentsImported: number;
  };
}

export default function SquareConnectionCard() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ConnectionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Phase 11e: "Delete all Square data" destructive action.
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/square/connection");
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

  // ── Phase 11c: backfill polling + chunk re-trigger ────────────
  // Mirrors WixConnectionCard. While the backfill is in-progress
  // (started but not completed), poll /api/square/connection every
  // 5s to surface progress, and re-POST /api/square/backfill
  // whenever the previous chunk's run finished. The route is
  // designed to be re-called safely (resumes from backfill_cursor).
  const [backfillBusy, setBackfillBusy] = useState(false);
  const backfillBusyRef = useRef(false);
  useEffect(() => {
    if (!state?.connected) return;
    const bf = state.backfill;
    if (!bf) return;
    if (bf.completedAt) return;

    const tick = async () => {
      if (!backfillBusyRef.current) {
        backfillBusyRef.current = true;
        setBackfillBusy(true);
        try {
          await fetch("/api/square/backfill", { method: "POST" });
        } catch {
          // ignore — next tick retries
        } finally {
          backfillBusyRef.current = false;
          setBackfillBusy(false);
        }
      }
      await loadState();
    };

    void tick();
    const id = window.setInterval(tick, BACKFILL_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [
    state?.connected,
    state?.backfill?.completedAt,
    state?.backfill?.startedAt,
    loadState,
  ]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/square/oauth/initiate", {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        authorizeUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.authorizeUrl) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Full-page redirect (not new tab) — Square wants to own
      // the consent screen + the callback round-trip atomically.
      // The state cookie was set by the initiate route; the
      // callback will land back on /integrations.
      window.location.href = data.authorizeUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connect failed");
      setConnecting(false);
    }
  }, []);

  const handleConfirmDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/square/disconnect", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setConfirmDisconnect(false);
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
      const res = await fetch("/api/square/purge-data", { method: "POST" });
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
          ? `Deleted ${count.toLocaleString()} Square payment${count === 1 ? "" : "s"} from your reports.`
          : "No Square payments to delete."
      );
      setConfirmPurge(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete data");
    } finally {
      setPurging(false);
    }
  }, []);

  // Display label: business name from Square if available, fallback
  // to truncated merchant ID.
  const displayLabel = (() => {
    if (state?.businessName) return state.businessName;
    if (state?.merchantId) return `Merchant ${state.merchantId.slice(0, 8)}…`;
    return "Connected merchant";
  })();

  // Token-expiry warning: when access token is within 7 days of
  // expiry. Square's lib/withAccessToken auto-refreshes, but if
  // the refresh chain has somehow failed (rare), surface it here
  // so the merchant can disconnect + reconnect cleanly.
  const tokenExpiringSoon = (() => {
    if (!state?.connected || !state.accessTokenExpiresAt) return false;
    const expiryMs = new Date(state.accessTokenExpiresAt).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return expiryMs < Date.now() + sevenDaysMs;
  })();

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-3">
        <Spinner size={16} color="#94a3b8" />
        <span className="text-sm text-slate-500">Loading Square status…</span>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">{"\u{1F4B3}"}</span>
            <div>
              <h3 className="text-base font-bold text-slate-900 m-0">
                Square
              </h3>
              <p className="text-xs text-slate-500 m-0">
                Auto-pull payments from POS, online, invoices, and more
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
              {state.environment === "sandbox" && (
                <span className="ml-2 inline-flex items-center text-[10px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5 uppercase tracking-wide">
                  Sandbox
                </span>
              )}
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

            {tokenExpiringSoon && (
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs">
                <p className="font-semibold text-amber-900 m-0 mb-1">
                  {"\u{26A0}\u{FE0F}"} Connection needs refresh soon
                </p>
                <p className="text-amber-800 m-0 leading-relaxed">
                  Square access expires{" "}
                  {state.accessTokenExpiresAt
                    ? new Date(
                        state.accessTokenExpiresAt
                      ).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    : "soon"}
                  . FlowWork normally refreshes this automatically — if
                  the indicator persists, disconnect and reconnect to
                  reset the cycle.
                </p>
              </div>
            )}

            {/* Sync status row */}
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
                      ? `${state.webhookCount} event type${state.webhookCount === 1 ? "" : "s"} active — new payments sync in seconds`
                      : "No webhook events received yet — payments sync via daily reconciliation"
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

            {/* Backfill UI — driven by the polling effect above */}
            {state.backfill?.startedAt && !state.backfill?.completedAt && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-blue-900 font-medium inline-flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                    Importing payments from Square…
                  </span>
                  <span className="text-blue-700 tabular-nums">
                    {state.backfill.paymentsImported.toLocaleString()} imported
                    {backfillBusy && (
                      <span className="ml-1.5 text-blue-500">•</span>
                    )}
                  </span>
                </div>
                <div className="w-full h-1 bg-blue-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 animate-pulse w-1/3" />
                </div>
                <p className="text-blue-700/80 mt-1.5 m-0">
                  Safe to leave this page — backfill continues in the
                  background.
                </p>
              </div>
            )}
            {state.backfill?.completedAt &&
              state.backfill.paymentsImported > 0 && (
                <div className="text-xs text-emerald-700 inline-flex items-center gap-1.5">
                  <span>{"\u{2705}"}</span>
                  <span>
                    Imported{" "}
                    {state.backfill.paymentsImported.toLocaleString()} payment
                    {state.backfill.paymentsImported === 1 ? "" : "s"} from
                    Square
                  </span>
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

            <ReimportLineItemsButton
              platform="square"
              platformLabel="Square payments"
            />

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
                Delete all Square data
              </button>
              <span className="text-xs text-slate-400">
                Disconnect stops new syncs. Delete removes imported
                payments from your reports too.
              </span>
            </div>
          </div>
        )}

        {/* Disconnected state — single Connect button. Unlike Shopify
            no shop-domain input needed; the merchant picks their
            Square account on Square's consent screen. */}
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
                {connecting ? "Redirecting…" : "Connect Square account"}
              </button>
              <span className="text-xs text-slate-500">
                You&apos;ll sign into your Square account and approve
                permissions to read payments.
              </span>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmDisconnect}
        title="Disconnect Square?"
        message="This stops new payments from syncing. Your historical Square data stays in your reports. You can reconnect any time."
        confirmLabel="Disconnect"
        danger
        busy={disconnecting}
        onConfirm={handleConfirmDisconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />

      <ConfirmModal
        open={confirmPurge}
        title="Delete all Square data?"
        message="This permanently removes every payment imported from Square from your FlowWork reports. This cannot be undone. Your Square connection stays active — disconnect separately if you want to stop syncing too."
        confirmLabel="Delete all Square data"
        danger
        busy={purging}
        onConfirm={handleConfirmPurge}
        onCancel={() => setConfirmPurge(false)}
      />
    </>
  );
}
