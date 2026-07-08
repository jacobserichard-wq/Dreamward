"use client";

// app/onboarding/page.tsx
//
// Sub-session 24 flow redesign commit 5 of 7. Rewrites the legacy
// 2-step onboarding form as the tier-aware SetupChecklist surface.
//
// The legacy form's industry pick + business name collection moves
// into the checklist's "tell_us_about_business" item (commit 4 added
// the inline form render). All other tier-specific setup steps live
// alongside it — same checklist a Pro user sees with white-glove
// highlighted, a Trial user just sees the minimal subset.
//
// Removed the returning-user guard from the legacy version — the
// new /onboarding is the canonical "setup checklist anytime" surface
// (commit 6 adds a nav link from /dashboard so users can revisit).
// onboarding_completed=true users land here without being bounced
// back to /dashboard; their form item just renders as ✓ Done.
//
// Skip mutations PATCH /api/settings with preferences.ux.checklist_items_skipped
// (the JSONB sub-key extends the preferences.ux shape introduced in the
// UX First-Run arc). Confirm modal wraps the skip per locked decision #4.

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SetupChecklist from "../components/SetupChecklist";
import OnboardingFlow from "../components/OnboardingFlow";
import ConfirmModal from "../components/ConfirmModal";
import Spinner from "../components/Spinner";
import ErrorBanner from "../components/ErrorBanner";
import { apiFetch } from "@/lib/apiFetch";

type Plan = "trial" | "dream" | "maker" | "growth" | "pro";

interface ClientInfo {
  plan: Plan;
  businessName: string | null;
  industry: string | null;
}

interface SettingsResponse {
  homeAddress?: string | null;
  laborHourlyRate?: number | null;
  settings?: {
    preferences?: Record<string, unknown>;
  };
}

interface ItemSummary {
  hasReal: boolean;
  hasGmail: boolean;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sourced from /api/client + /api/settings + counts.
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [homeAddress, setHomeAddress] = useState<string>("");
  const [preferences, setPreferences] = useState<Record<string, unknown>>({});
  const [itemSummary, setItemSummary] = useState<ItemSummary>({
    hasReal: false,
    hasGmail: false,
  });
  const [eventCount, setEventCount] = useState(0);
  const [invoiceCount, setInvoiceCount] = useState(0);
  const [hasSku, setHasSku] = useState(false);
  const [hasCostedSku, setHasCostedSku] = useState(false);
  const [storeConnected, setStoreConnected] = useState(false);
  const [bankConnected, setBankConnected] = useState(false);
  const [laborRateSet, setLaborRateSet] = useState(false);

  // Skip flow state.
  const [pendingSkipId, setPendingSkipId] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);

  // ── Load everything the checklist needs in parallel ────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        clientRes,
        settingsRes,
        itemsRes,
        eventsRes,
        invoicesRes,
        skusRes,
        shopifyRes,
        squareRes,
        wixRes,
        etsyRes,
        plaidRes,
      ] = await Promise.allSettled([
        fetch("/api/client"),
        fetch("/api/settings"),
        fetch("/api/items"),
        fetch("/api/events"),
        fetch("/api/invoices?limit=1"),
        fetch("/api/skus"),
        // Fable-5 audit fix: the "Connect your store" checklist step
        // keys off real connection status, not hasSku (connecting a
        // store doesn't create SKUs, and a manual SKU shouldn't tick
        // the step). All four endpoints return { connected: bool }.
        fetch("/api/shopify/connection"),
        fetch("/api/square/connection"),
        fetch("/api/wix/connection"),
        fetch("/api/etsy/connection"),
        // 2026-07-07 (Plaid live): drives the connect_bank step.
        // Returns { items: [...] } — connected = non-empty.
        fetch("/api/plaid/items"),
      ]);

      // /api/client — required; bail to /signin if unauthenticated
      if (clientRes.status === "fulfilled" && clientRes.value.ok) {
        const data = (await clientRes.value.json()) as ClientInfo;
        setClientInfo(data);
      } else if (clientRes.status === "fulfilled" && clientRes.value.status === 401) {
        router.replace("/signin?callbackUrl=/onboarding");
        return;
      }

      if (settingsRes.status === "fulfilled" && settingsRes.value.ok) {
        const data = (await settingsRes.value.json()) as SettingsResponse;
        setHomeAddress(typeof data.homeAddress === "string" ? data.homeAddress : "");
        setLaborRateSet(typeof data.laborHourlyRate === "number");
        setPreferences(
          data.settings?.preferences &&
            typeof data.settings.preferences === "object"
            ? (data.settings.preferences as Record<string, unknown>)
            : {}
        );
      }

      if (itemsRes.status === "fulfilled" && itemsRes.value.ok) {
        const data = (await itemsRes.value.json()) as {
          items?: Array<{ source?: string }>;
        };
        const items = Array.isArray(data.items) ? data.items : [];
        setItemSummary({
          hasReal: items.some((i) => i.source !== "sample"),
          hasGmail: items.some(
            (i) => i.source === "gmail" || i.source === "email"
          ),
        });
      }

      if (eventsRes.status === "fulfilled" && eventsRes.value.ok) {
        const data = (await eventsRes.value.json()) as {
          events?: unknown[];
        };
        setEventCount(Array.isArray(data.events) ? data.events.length : 0);
      }

      if (invoicesRes.status === "fulfilled" && invoicesRes.value.ok) {
        const data = (await invoicesRes.value.json()) as {
          invoices?: unknown[];
        };
        setInvoiceCount(
          Array.isArray(data.invoices) ? data.invoices.length : 0
        );
      }

      // Sub-session 33: SKU signals drive the two COGS-onboarding
      // steps. hasSku = catalog populated (store synced or manual);
      // hasCostedSku = at least one SKU has a cost row (gross-margin
      // tracking active). /api/skus 403s for non-paying tiers — the
      // allSettled + .ok guard means that just leaves both false.
      if (skusRes.status === "fulfilled" && skusRes.value.ok) {
        const data = (await skusRes.value.json()) as {
          skus?: Array<{ currentCost: number | null }>;
        };
        const skus = Array.isArray(data.skus) ? data.skus : [];
        setHasSku(skus.length > 0);
        setHasCostedSku(skus.some((s) => s.currentCost != null));
      }

      // Any of the four platform connections counts as "store
      // connected". Failed fetches just leave it false.
      let connected = false;
      for (const res of [shopifyRes, squareRes, wixRes, etsyRes]) {
        if (res.status === "fulfilled" && res.value.ok) {
          const data = (await res.value.json().catch(() => null)) as {
            connected?: boolean;
          } | null;
          if (data?.connected) connected = true;
        }
      }
      setStoreConnected(connected);

      // Bank feed (Plaid) — the expense mirror of storeConnected.
      if (plaidRes.status === "fulfilled" && plaidRes.value.ok) {
        const data = (await plaidRes.value.json().catch(() => null)) as {
          items?: unknown[];
        } | null;
        setBankConnected(
          Array.isArray(data?.items) && data.items.length > 0
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load setup data");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Skip / unskip handlers ─────────────────────────────────────
  const handleRequestSkip = useCallback((itemId: string) => {
    setPendingSkipId(itemId);
  }, []);

  const handleConfirmSkip = useCallback(async () => {
    if (!pendingSkipId) return;
    setSkipping(true);
    try {
      const currentUx =
        (preferences.ux as Record<string, unknown> | undefined) ?? {};
      const currentSkipped =
        (currentUx.checklist_items_skipped as Record<string, string>) ?? {};
      const nextSkipped = {
        ...currentSkipped,
        [pendingSkipId]: new Date().toISOString(),
      };
      const nextPrefs = {
        ...preferences,
        ux: { ...currentUx, checklist_items_skipped: nextSkipped },
      };
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: nextPrefs }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      setPreferences(nextPrefs);
      setPendingSkipId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't skip item");
    } finally {
      setSkipping(false);
    }
  }, [pendingSkipId, preferences]);

  const handleUnskip = useCallback(
    async (itemId: string) => {
      try {
        const currentUx =
          (preferences.ux as Record<string, unknown> | undefined) ?? {};
        const currentSkipped = {
          ...((currentUx.checklist_items_skipped as Record<string, string>) ?? {}),
        };
        delete currentSkipped[itemId];
        const nextPrefs = {
          ...preferences,
          ux: { ...currentUx, checklist_items_skipped: currentSkipped },
        };
        const res = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferences: nextPrefs }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setPreferences(nextPrefs);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't un-skip item");
      }
    },
    [preferences]
  );

  // ── Business-info form submit (the new inline item) ────────────
  const handleSubmitBusinessInfo = useCallback(
    async (data: { businessName: string; industry: string }) => {
      const res = await apiFetch<{ plan: string }>("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      // Re-load clientInfo so the checklist item flips to ✓ Done.
      // Don't redirect — the checklist might have other items pending.
      await loadAll();
      // No router.push — user stays on /onboarding to finish or skip
      // remaining items. Per design §6 (loose onboarding-completed
      // semantics), they can leave anytime via the "All set!" CTA card
      // or by closing the tab.
      return res as unknown as void;
    },
    [loadAll]
  );

  // ── Render gates ───────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-700 p-4 sm:p-6 font-sans">
        <div className="bg-white rounded-2xl p-6 sm:py-10 sm:px-9 max-w-[560px] w-full text-center">
          <Spinner />
          <p className="text-sm text-slate-500 mt-4 m-0">Loading setup...</p>
        </div>
      </div>
    );
  }

  if (!clientInfo) {
    // Defensive: /api/client failed without 401. Show an error rather
    // than render the checklist with garbage state.
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <ErrorBanner
          message={error ?? "Couldn't load your account info."}
          onDismiss={() => setError(null)}
        />
      </div>
    );
  }

  const skipped =
    (preferences.ux &&
      typeof preferences.ux === "object" &&
      (preferences.ux as Record<string, unknown>).checklist_items_skipped) ||
    {};

  const industrySet =
    typeof clientInfo.industry === "string" &&
    clientInfo.industry.length > 0 &&
    typeof clientInfo.businessName === "string" &&
    clientInfo.businessName.length > 0;

  const cpaEmailSet = (() => {
    const cpa = preferences.cpa;
    return (
      cpa !== null &&
      typeof cpa === "object" &&
      typeof (cpa as Record<string, unknown>).email === "string" &&
      ((cpa as Record<string, unknown>).email as string).trim() !== ""
    );
  })();

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-[820px] mx-auto py-8 px-4 sm:px-6">
        {/* Branded header for the public-facing onboarding surface */}
        <div className="mb-6">
          <Link
            href="/dashboard"
            className="text-sm text-slate-500 hover:text-slate-700 no-underline inline-flex items-center gap-1"
          >
            {"\u{2190}"} <span>Dreamward</span>
          </Link>
        </div>

        {/* The whole-system flow up front. New users get the model before
            the checklist — what they set up (steps 1–3) vs what runs on its
            own (4–5) — without a forced gate. */}
        <OnboardingFlow />

        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        )}

        <SetupChecklist
          mode="onboarding"
          plan={clientInfo.plan}
          gmailConnected={itemSummary.hasGmail}
          hasRealProcessedItems={itemSummary.hasReal}
          homeAddressSet={homeAddress.trim().length > 0}
          cpaEmailSet={cpaEmailSet}
          taxBracketSet={
            preferences.taxBracket !== undefined &&
            preferences.taxBracket !== null
          }
          industrySet={industrySet}
          hasEvents={eventCount > 0}
          hasInvoices={invoiceCount > 0}
          hasSku={hasSku}
          hasCostedSku={hasCostedSku}
          storeConnected={storeConnected}
          bankConnected={bankConnected}
          laborRateSet={laborRateSet}
          businessName={clientInfo.businessName ?? ""}
          industry={clientInfo.industry ?? ""}
          skipped={skipped as Record<string, string>}
          onDismiss={() => {
            /* dismiss disabled in onboarding mode */
          }}
          onClearSample={() => {
            // The clear-sample action lives on the dashboard. Send
            // the user there with a hint; they come back if they
            // want via the dashboard's nav link (commit 6).
            router.push("/dashboard");
          }}
          onUploadClick={() => {
            // The file input lives on the dashboard. ?upload=1 makes
            // the dashboard show a "pick your file up here" hint so
            // the click doesn't feel like a dead end (Fable-5 audit).
            router.push("/dashboard?upload=1");
          }}
          onSkip={handleRequestSkip}
          onUnskip={handleUnskip}
          onSubmitBusinessInfo={handleSubmitBusinessInfo}
        />

        <ConfirmModal
          open={pendingSkipId !== null}
          title="Skip this step?"
          message="Skipped steps won't appear on your checklist anymore. You can un-skip them from the bottom of this page if you change your mind."
          confirmLabel="Skip permanently"
          busy={skipping}
          onConfirm={handleConfirmSkip}
          onCancel={() => setPendingSkipId(null)}
        />
      </div>
    </div>
  );
}
