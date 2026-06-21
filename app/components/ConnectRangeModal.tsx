// app/components/ConnectRangeModal.tsx
//
// Shared "choose how far back to import, then connect" modal for the
// OAuth platform integrations (Square/Etsy/Wix/Shopify). Mirrors the step
// Plaid shows before Link: the timeframe is an explicit choice the user
// can't miss. On Continue it hands the resolved start date (YYYY-MM-DD or
// null = all history) to onContinue, which kicks off that provider's OAuth
// redirect (the card passes the date to its /initiate route).

"use client";

import { useRef } from "react";
import ImportRangePicker from "./ImportRangePicker";

export default function ConnectRangeModal({
  open,
  providerName,
  onContinue,
  onCancel,
}: {
  open: boolean;
  providerName: string;
  onContinue: (startDate: string | null) => void;
  onCancel: () => void;
}) {
  const startDateRef = useRef<string | null>(null);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-range-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
      >
        <h2
          id="connect-range-title"
          className="text-lg font-bold text-slate-900 m-0 mb-1"
        >
          Connect {providerName}
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-4">
          Choose how far back to import, then you&apos;ll sign in to{" "}
          {providerName} and approve access.
        </p>
        <ImportRangePicker
          onChange={(d) => {
            startDateRef.current = d;
          }}
          className="mb-5"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="py-2 px-4 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onContinue(startDateRef.current)}
            className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer inline-flex items-center gap-2"
          >
            Continue to {providerName} {"\u{2192}"}
          </button>
        </div>
      </div>
    </div>
  );
}
