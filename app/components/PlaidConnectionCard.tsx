// app/components/PlaidConnectionCard.tsx
//
// Plaid bank-feed (Phase 1). Connect bank accounts via Plaid Link.
// Unlike the platform cards (Shopify/Square/etc.) this uses Plaid's
// in-page Link modal (usePlaidLink) rather than an OAuth redirect, and
// supports MULTIPLE connected banks (one row per institution login).
//
// Phase 1 scope = the connect flow only: list connected items + add /
// disconnect. Transaction ingest (debits-only → Transactions) is
// Phase 2. The card frames the feature as the EXPENSE source — sales
// keep coming from the store integrations.
//
// Connect flow: click → POST /api/plaid/link-token → usePlaidLink opens
// once the token + SDK are ready → onSuccess hands the public_token +
// institution metadata to POST /api/plaid/exchange (which stores the
// encrypted access token).

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  usePlaidLink,
  type PlaidLinkOnSuccessMetadata,
} from "react-plaid-link";
import Spinner from "./Spinner";
import ImportRangePicker from "./ImportRangePicker";

interface PlaidItem {
  id: number;
  itemId: string;
  institutionName: string | null;
  status: string;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  connectedAt: string;
  environment: string;
}

export default function PlaidConnectionCard() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PlaidItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState<PlaidItem | null>(
    null
  );
  const [disconnecting, setDisconnecting] = useState(false);
  // Chosen "import from" cutoff (YYYY-MM-DD or null = all history). Held in
  // a ref so updating it doesn't re-create onSuccess / re-init Plaid Link.
  const importStartDateRef = useRef<string | null>(null);
  const handleRangeChange = useCallback((d: string | null) => {
    importStartDateRef.current = d;
  }, []);
  // Connect flow now asks the import range as an explicit step BEFORE
  // launching Plaid Link (the inline picker was easy to miss).
  const [showConnectModal, setShowConnectModal] = useState(false);
  // Disconnect option: also delete the expenses this bank imported.
  const [purgeOnDisconnect, setPurgeOnDisconnect] = useState(false);

  const loadItems = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/plaid/items");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { items: PlaidItem[] };
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Exchange the public token + persist the connection (the encrypted
  // access token lands server-side in plaid_items).
  const onSuccess = useCallback(
    async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      setConnecting(true);
      setError(null);
      try {
        const res = await fetch("/api/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicToken,
            institutionId: metadata.institution?.institution_id ?? null,
            institutionName: metadata.institution?.name ?? null,
            importStartDate: importStartDateRef.current,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        await loadItems();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't connect bank");
      } finally {
        setConnecting(false);
        setLinkToken(null);
      }
    },
    [loadItems]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => {
      // User closed Link without finishing (or it errored). Reset so the
      // button is clickable again.
      setConnecting(false);
      setLinkToken(null);
    },
  });

  // usePlaidLink can't be called conditionally, so we fetch the token
  // first, then auto-open once both the token and the SDK are ready.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    setNotConfigured(false);
    try {
      const res = await fetch("/api/plaid/link-token", { method: "POST" });
      if (res.status === 503) {
        // Plaid creds not configured yet — show a clean note, not an error.
        setNotConfigured(true);
        setConnecting(false);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { linkToken: string };
      setLinkToken(data.linkToken); // the effect opens Link when ready
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't start connection"
      );
      setConnecting(false);
    }
  }, []);

  const handleConfirmDisconnect = useCallback(async () => {
    if (!confirmDisconnect) return;
    setDisconnecting(true);
    try {
      const res = await fetch(
        `/api/plaid/items?itemId=${encodeURIComponent(confirmDisconnect.itemId)}&purge=${purgeOnDisconnect}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setConfirmDisconnect(null);
      setPurgeOnDisconnect(false);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  }, [confirmDisconnect, loadItems]);

  const hasItems = items.length > 0;

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-3">
        <Spinner size={16} color="#94a3b8" />
        <span className="text-sm text-slate-500">Loading bank status…</span>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">{"\u{1F3E6}"}</span>
            <div>
              <h3 className="text-base font-bold text-slate-900 m-0">
                Bank accounts
              </h3>
              <p className="text-xs text-slate-500 m-0">
                Auto-pull <strong>expenses</strong> from your bank via Plaid
              </p>
            </div>
          </div>
          {hasItems ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {items.length} connected
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

        {notConfigured && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 rounded-lg mb-3 text-xs">
            Bank connections aren&apos;t switched on yet. Check back soon.
          </div>
        )}

        {/* Connected items */}
        {hasItems && (
          <ul className="space-y-2 mb-3 m-0 p-0 list-none">
            {items.map((it) => (
              <li
                key={it.itemId}
                className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="text-sm text-slate-800 font-medium flex items-center gap-2 flex-wrap">
                    <span className="truncate">
                      {it.institutionName || "Connected bank"}
                    </span>
                    {it.environment === "sandbox" && (
                      <span className="inline-flex items-center text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 uppercase tracking-wide">
                        Sandbox
                      </span>
                    )}
                    {it.status !== "active" && (
                      <span className="inline-flex items-center text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 uppercase tracking-wide">
                        Needs attention
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 m-0">
                    Connected{" "}
                    {new Date(it.connectedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    {it.lastSyncAt
                      ? ` · last sync ${new Date(it.lastSyncAt).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric" }
                        )}`
                      : " · no sync yet"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDisconnect(it);
                    setPurgeOnDisconnect(false);
                  }}
                  className="py-1.5 px-3 rounded border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Connect section — opens the range modal first, which then
            launches Plaid Link on "Continue". */}
        <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setShowConnectModal(true)}
            disabled={connecting}
            className="py-2 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold cursor-pointer border-0 disabled:opacity-60 disabled:cursor-wait inline-flex items-center gap-2"
          >
            {connecting && <Spinner size={12} color="white" />}
            {connecting
              ? "Connecting…"
              : hasItems
                ? "Connect another bank"
                : "Connect a bank"}
          </button>
          <span className="text-xs text-slate-500">
            <strong>Bank = your spending.</strong> Sales come from your shops +
            &ldquo;Add a sale&rdquo; — we don&apos;t count deposits as income
            (that would double-count your shop payouts).
          </span>
        </div>
      </div>

      {/* Connect step: choose the import range, then launch Plaid Link. */}
      {showConnectModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="plaid-connect-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setShowConnectModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <h2
              id="plaid-connect-title"
              className="text-lg font-bold text-slate-900 m-0 mb-1"
            >
              {"\u{1F3E6}"} Connect a bank
            </h2>
            <p className="text-xs text-slate-500 m-0 mb-4">
              Choose how far back to import, then you&apos;ll log in to your
              bank securely through Plaid. We pull spending (expenses) only.
            </p>
            <ImportRangePicker onChange={handleRangeChange} className="mb-5" />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConnectModal(false)}
                className="py-2 px-4 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConnectModal(false);
                  handleConnect();
                }}
                className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer inline-flex items-center gap-2"
              >
                Continue to your bank {"\u{2192}"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect modal with the optional "remove imported" checkbox. */}
      {confirmDisconnect && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="plaid-disconnect-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => {
            if (!disconnecting) setConfirmDisconnect(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <h2
              id="plaid-disconnect-title"
              className="text-lg font-bold text-slate-900 m-0 mb-1"
            >
              Disconnect {confirmDisconnect.institutionName || "this bank"}?
            </h2>
            <p className="text-sm text-slate-600 m-0 mb-4">
              This stops pulling new transactions and removes the connection.
              You can reconnect any time.
            </p>
            <label className="flex items-start gap-2 mb-5 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={purgeOnDisconnect}
                onChange={(e) => setPurgeOnDisconnect(e.target.checked)}
                disabled={disconnecting}
                className="mt-0.5"
              />
              <span>
                Also remove the expenses this bank imported.{" "}
                <span className="text-slate-400">
                  Use this to clear a wrong import and reconnect with a
                  different date. Leave unchecked to keep them in your reports.
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDisconnect(null)}
                disabled={disconnecting}
                className="py-2 px-4 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer disabled:opacity-40 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDisconnect}
                disabled={disconnecting}
                className="py-2 px-4 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
              >
                {disconnecting && <Spinner size={12} color="white" />}
                {disconnecting
                  ? "Disconnecting…"
                  : purgeOnDisconnect
                    ? "Disconnect + remove"
                    : "Disconnect"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
