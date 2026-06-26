// app/components/StripeConnectionCard.tsx
//
// /integrations card for Stripe CONNECT as a SALES CHANNEL — a customer
// connects their own Stripe account so the charges they collect from their
// buyers sync in as income. Deliberately labeled "sales you collect" to
// keep it distinct from the platform's subscription billing.
//
// Connect → POST /api/stripe-connect/oauth/initiate → redirect to Stripe.
// Connected → show status + "Sync now" (chunked backfill) + Disconnect.

"use client";

import { useCallback, useEffect, useState } from "react";

interface ConnectionState {
  connected: boolean;
  businessName?: string | null;
  livemode?: boolean;
  lastSyncAt?: string | null;
  liveSyncActive?: boolean;
  backfill?: {
    completedAt: string | null;
    chargesImported: number;
  };
}

export default function StripeConnectionCard() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ConnectionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/stripe-connect/connection");
      if (!res.ok) {
        // 403 (non-Pro) or error — treat as not connected; card still shows
        // the connect CTA (the initiate call will surface the gate).
        setState({ connected: false });
        return;
      }
      setState(await res.json());
    } catch {
      setError("Couldn't load Stripe status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe-connect/oauth/initiate", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't start the Stripe connection.");
        setConnecting(false);
        return;
      }
      window.location.href = data.authorizeUrl;
    } catch {
      setError("Couldn't start the Stripe connection.");
      setConnecting(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    setError(null);
    try {
      let total = 0;
      // Chunked backfill: re-POST until hasMore is false (caps at 50 rounds
      // = 100k charges, far beyond any small-maker volume).
      for (let i = 0; i < 50; i++) {
        const res = await fetch("/api/stripe-connect/backfill", {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Sync failed.");
          break;
        }
        total = data.totalImported ?? total;
        if (!data.hasMore) break;
      }
      setSyncMsg(`Synced — ${total} charge${total === 1 ? "" : "s"} imported.`);
      await load();
    } catch {
      setError("Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe-connect/disconnect", {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Couldn't disconnect.");
        return;
      }
      setConfirmDisconnect(false);
      await load();
    } catch {
      setError("Couldn't disconnect.");
    } finally {
      setDisconnecting(false);
    }
  };

  const connected = state?.connected === true;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-2xl" aria-hidden="true">
            {"\u{1F4B3}"}
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900 m-0">
              Stripe
            </h3>
            <p className="text-xs text-slate-500 m-0">
              Sync the sales you collect through Stripe
            </p>
          </div>
        </div>
        {connected && (
          <span className="flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            Connected
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500 m-0 py-2">Loading…</p>
      ) : connected ? (
        <>
          <div className="text-sm text-slate-600 space-y-1 mb-3">
            <p className="m-0">
              <span className="text-slate-400">Account:</span>{" "}
              <span className="font-medium text-slate-800">
                {state?.businessName || "Connected Stripe account"}
              </span>
              {state?.livemode === false && (
                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                  Test mode
                </span>
              )}
            </p>
            <p className="m-0">
              <span className="text-slate-400">Imported:</span>{" "}
              <span className="font-medium text-slate-800">
                {state?.backfill?.chargesImported ?? 0} charge
                {(state?.backfill?.chargesImported ?? 0) === 1 ? "" : "s"}
              </span>
            </p>
            <p className="m-0">
              <span className="text-slate-400">Live sync:</span>{" "}
              {state?.liveSyncActive ? (
                <span className="text-emerald-700 font-medium">active</span>
              ) : (
                <span className="text-slate-500">
                  waiting for first webhook
                </span>
              )}
            </p>
          </div>

          {syncMsg && (
            <p className="text-xs text-emerald-700 m-0 mb-2">{syncMsg}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={sync}
              disabled={syncing}
              className="text-xs font-semibold py-1.5 px-3 rounded-md border border-blue-300 bg-white text-blue-700 hover:bg-blue-50 cursor-pointer disabled:opacity-60"
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            {confirmDisconnect ? (
              <>
                <button
                  type="button"
                  onClick={disconnect}
                  disabled={disconnecting}
                  className="text-xs font-semibold py-1.5 px-3 rounded-md border-0 bg-red-600 text-white hover:bg-red-700 cursor-pointer disabled:opacity-60"
                >
                  {disconnecting ? "Disconnecting…" : "Confirm disconnect"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDisconnect(false)}
                  disabled={disconnecting}
                  className="text-xs font-medium py-1.5 px-3 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDisconnect(true)}
                className="text-xs font-medium py-1.5 px-3 rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Disconnect
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600 m-0 mb-3">
            Connect your Stripe account and the payments you take from your
            buyers flow in as income automatically.
          </p>
          <button
            type="button"
            onClick={connect}
            disabled={connecting}
            className="text-sm font-semibold py-2 px-4 rounded-lg border-0 bg-green-600 text-white hover:bg-green-700 cursor-pointer disabled:opacity-60"
          >
            {connecting ? "Starting…" : "Connect Stripe"}
          </button>
        </>
      )}
    </div>
  );
}
