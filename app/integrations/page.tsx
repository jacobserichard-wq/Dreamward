// app/integrations/page.tsx
//
// Phase 8b commit 3 of 3 (commit 9 of Phase 8 overall).
//
// /integrations — the user-facing hub for connecting external
// platforms. Live self-serve: Square (+ bank feed via Plaid, + Stripe).
// Shopify, Wix, and Etsy are each gated by a FEATURES.*_ENABLED flag
// (all false as of 2026-07-03): Etsy's app was banned, Shopify never
// chose distribution, Wix isn't App-Market-published — none are
// strangers-connectable yet. A false flag renders that platform as a
// "Coming soon" card instead of a live connect card + hides its
// bulk-import tab; flip the flag once the platform is approved. Also
// placeholder-only: WooCommerce, Stripe Connect.
//
// Pro-gated (matches every other /api/shopify/* + /api/wix/* route
// + the /reports page pattern). Non-Pro users see an amber upgrade
// card with a "View plans" CTA.
//
// URL params surfaced as banners:
//   ?connected=1&shop=...    → green "Connected to my-store.myshopify.com" toast
//   ?connected_wix=1&site=... → green "Connected to <site display name>!" toast
//                               (Phase 10a callback emits these on success)
//   ?error=<msg>             → red error banner
//   ?upgrade=success         → emerald "Extended backfill unlocked" toast
//                              (sub-phase 8c triggers this from the Stripe
//                              webhook handler; safe to render now since the
//                              check is just "is the param present")

"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "../components/PageHeader";
import AppHeader from "../components/AppHeader";
import { SUPPORT_EMAIL } from "@/lib/support";
import ErrorBanner from "../components/ErrorBanner";
import SectionTip from "../components/SectionTip";
import EtsyConnectionCard from "../components/EtsyConnectionCard";
import PlaidConnectionCard from "../components/PlaidConnectionCard";
import { FEATURES } from "@/lib/features";
import ShopifyConnectionCard from "../components/ShopifyConnectionCard";
import SquareConnectionCard from "../components/SquareConnectionCard";
import StripeConnectionCard from "../components/StripeConnectionCard";
import WixConnectionCard from "../components/WixConnectionCard";
import { isPayingTier } from "@/lib/plans";

interface ClientInfo {
  plan: string;
}

// Phase 8b fix-up (post-push 1): wrap the inner component (which uses
// useSearchParams) in <Suspense> so Next 15+ static prerendering can
// build the page. Without the Suspense boundary, the build fails
// with "missing-suspense-with-csr-bailout" at the /integrations route.
// Pattern per https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout
export default function IntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 font-sans">
          <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
            <p className="text-center p-[60px] text-slate-500">
              Loading integrations…
            </p>
          </div>
        </div>
      }
    >
      <IntegrationsPageInner />
    </Suspense>
  );
}

function IntegrationsPageInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [plan, setPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Surface OAuth callback / Stripe upgrade callback messages from
  // the URL params Shopify (or our own callback handlers) redirect
  // back with. Wipe the params after reading so a reload doesn't
  // re-show the same toast.
  useEffect(() => {
    const connected = params.get("connected");
    const shop = params.get("shop");
    const connectedWix = params.get("connected_wix");
    const site = params.get("site");
    const connectedSquare = params.get("connected_square");
    const merchant = params.get("merchant");
    // Etsy's callback redirects with connected_etsy=1&shop=<shopName>.
    // The shop param is shared with Shopify's flow, but Shopify also
    // sets connected=1 — the branch order below keeps them apart.
    const connectedEtsy = params.get("connected_etsy");
    const connectedStripe = params.get("connected_stripe");
    const errParam = params.get("error");
    const upgrade = params.get("upgrade");
    // Auto-bind handoff from the Wix Dashboard Extension bridge page
    // (/wix-bridge). When a merchant clicks "Open Dreamward" in the
    // Wix-embedded iframe, they land here with this param + their
    // Dreamward session. We POST to /api/wix/bind to finish the
    // connection, then show success/failure via the existing
    // banner plumbing.
    const wixBindInstance = params.get("wix_bind_instance");
    // App Store install handoff: the OAuth callback stored a PENDING
    // connection (no session at install time) and routed the merchant
    // through /signin back here with ?shopify_pending=<shop>. We claim
    // it via POST /api/shopify/bind, then hard-navigate with the
    // standard connected params so every card remounts with the fresh
    // connection state.
    const shopifyPending = params.get("shopify_pending");

    if (connected === "1" && shop) {
      setSuccessMsg(`Connected to ${shop}!`);
    } else if (connectedEtsy === "1") {
      setSuccessMsg(
        shop
          ? `Connected to ${shop}! Importing your order history now…`
          : "Etsy shop connected! Importing your order history now…"
      );
    } else if (connectedSquare === "1") {
      setSuccessMsg(
        merchant ? `Connected to ${merchant}!` : "Square account connected!"
      );
    } else if (connectedStripe === "1") {
      setSuccessMsg(
        merchant ? `Connected to ${merchant}!` : "Stripe account connected!"
      );
    } else if (connectedWix === "1") {
      // siteDisplayName is best-effort — Wix's Sites API call can fail
      // and we still want to show success. Fall back to a generic
      // message when site=... wasn't on the redirect URL.
      setSuccessMsg(
        site ? `Connected to ${site}!` : "Wix site connected!"
      );
    } else if (upgrade === "success") {
      setSuccessMsg("Extended backfill unlocked — pulling the rest of your order history now.");
    } else if (errParam) {
      setError(errParam);
    } else if (wixBindInstance) {
      // Auto-bind path — fire-and-forget POST, surface result in
      // banners. Strip the param even if the call is still in flight
      // so a reload doesn't re-attempt.
      void (async () => {
        try {
          const res = await fetch("/api/wix/bind", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ instanceId: wixBindInstance }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            bound?: boolean;
            siteDisplayName?: string | null;
            alreadyBound?: boolean;
            error?: string;
          };
          if (!res.ok || !data.bound) {
            setError(data.error || `Couldn't connect Wix (HTTP ${res.status})`);
            return;
          }
          if (data.alreadyBound) {
            setSuccessMsg("Wix site already connected.");
          } else {
            setSuccessMsg(
              data.siteDisplayName
                ? `Connected to ${data.siteDisplayName}!`
                : "Wix site connected!"
            );
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't connect Wix");
        }
      })();
    } else if (shopifyPending) {
      setSuccessMsg(`Finishing your Shopify connection to ${shopifyPending}…`);
      void (async () => {
        try {
          const res = await fetch("/api/shopify/bind", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shop: shopifyPending }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            bound?: boolean;
            error?: string;
          };
          if (!res.ok || !data.bound) {
            setSuccessMsg(null);
            setError(
              data.error || `Couldn't connect Shopify (HTTP ${res.status})`
            );
            return;
          }
          // Full navigation (not router.replace) so the Shopify card
          // remounts and refetches its now-bound connection state.
          window.location.replace(
            `/integrations?connected=1&shop=${encodeURIComponent(shopifyPending)}`
          );
        } catch (err) {
          setSuccessMsg(null);
          setError(
            err instanceof Error ? err.message : "Couldn't connect Shopify"
          );
        }
      })();
    }

    if (
      connected ||
      connectedEtsy ||
      connectedSquare ||
      connectedWix ||
      errParam ||
      upgrade ||
      wixBindInstance ||
      shopifyPending
    ) {
      // Strip the params so reload doesn't replay the toast / re-bind.
      router.replace("/integrations");
    }
  }, [params, router]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/client");
        if (res.status === 401) {
          router.replace("/signin?callbackUrl=/integrations");
          return;
        }
        if (!res.ok) {
          setError(`Couldn't load account info (HTTP ${res.status})`);
          return;
        }
        const data = (await res.json()) as ClientInfo;
        setPlan(data.plan);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load page");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">
            Loading integrations…
          </p>
        </div>
      </div>
    );
  }

  // Non-paying: upgrade card. Under the new "everyone gets every
  // feature" pricing, this only fires for canceled/non-subscribed
  // users since trial / dream / maker / growth / pro all qualify.
  if (!isPayingTier(plan)) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            title="Integrations"
            subtitle="Connect your online store, payment processor, and other revenue sources"
          />
          <div className="bg-amber-50 border border-amber-200 rounded-xl py-8 px-6 text-center">
            <p className="text-base font-medium text-amber-900 m-0 mb-2">
              {"\u{1F512}"} Active subscription required
            </p>
            <p className="text-sm text-amber-800 m-0 mb-5 leading-relaxed max-w-md mx-auto">
              Subscribe (plans start at $10/mo) to connect Square and
              pull orders + revenue automatically into Dreamward — or
              import anything via CSV. Coming soon: Shopify, Wix, Etsy,
              WooCommerce, Stripe Connect.
            </p>
            <Link
              href="/billing"
              className="inline-block py-2.5 px-6 rounded-lg bg-amber-600 text-white text-sm font-semibold no-underline cursor-pointer"
            >
              View plans
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <AppHeader />
      <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          title="Integrations"
          subtitle="Connect your online store, payment processor, and other revenue sources"
        />

        <SectionTip id="integrations" title="Connect a store to automate everything">
          Connecting Square pulls in your order history and keeps it
          synced — no manual uploads (Shopify, Wix &amp; Etsy are on the
          way). To build your{" "}
          <strong>SKUs</strong> catalog from it, use <strong>Bulk import</strong>{" "}
          — one click pulls every product from the platform (Square even brings
          the costs from its Item Library) — or map items from the Unmatched
          queue as they sell. Then cost your SKUs (receive purchases into
          inventory) to see gross margin.
        </SectionTip>

        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        )}

        {successMsg && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg mb-4 text-sm flex justify-between items-center gap-3 flex-wrap">
            <span className="font-medium">{"\u{2705}"} {successMsg}</span>
            <button
              type="button"
              onClick={() => setSuccessMsg(null)}
              className="text-emerald-700 hover:underline cursor-pointer text-xs bg-transparent border-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Live integrations */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">
            Available now
          </h2>
          <div className="space-y-3">
            {/* Plaid bank feed: gated by FEATURES.PLAID_ENABLED (false
                2026-07-05 — production works but the account is in Plaid's
                limited state; connecting real banks needs a 2-4 wk OAuth
                institution review, so it's a dead-end until then). */}
            {FEATURES.PLAID_ENABLED && <PlaidConnectionCard />}
            {/* Shopify / Wix / Etsy: each gated by its FEATURES.*_ENABLED
                flag (all false 2026-07-03 — see lib/features.ts). While
                false the live connect card is hidden and the platform
                shows as a Coming-soon card below instead. */}
            {FEATURES.SHOPIFY_ENABLED && <ShopifyConnectionCard />}
            {FEATURES.WIX_ENABLED && <WixConnectionCard />}
            <SquareConnectionCard />
            {FEATURES.ETSY_ENABLED && <EtsyConnectionCard />}
            <StripeConnectionCard />
          </div>
        </div>

        {/* Coming soon — placeholder cards. Each is a static card with
            the platform name + "Coming soon" pill, no Connect button.
            Signals roadmap without commitment to a specific timeline. */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">
            Coming soon
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {!FEATURES.PLAID_ENABLED && (
              <ComingSoonCard
                icon={"\u{1F3E6}"}
                name="Bank accounts"
                subtitle="Auto-pull expenses from your bank via Plaid"
              />
            )}
            {!FEATURES.SHOPIFY_ENABLED && (
              <ComingSoonCard
                icon={"\u{1F6D2}"}
                name="Shopify"
                subtitle="Auto-pull orders + revenue from your store"
              />
            )}
            {!FEATURES.WIX_ENABLED && (
              <ComingSoonCard
                icon={"\u{1F310}"}
                name="Wix"
                subtitle="Sync orders from your Wix store"
              />
            )}
            {!FEATURES.ETSY_ENABLED && (
              <ComingSoonCard
                icon={"\u{1F3F7}\u{FE0F}"}
                name="Etsy"
                subtitle="Shop orders + per-listing line items"
              />
            )}
            <ComingSoonCard
              icon={"\u{1F6D2}"}
              name="WooCommerce"
              subtitle="Self-hosted WordPress stores"
            />
            <ComingSoonCard
              icon={"\u{1F4B0}"}
              name="Stripe Connect"
              subtitle="Any custom site that checks out via Stripe"
            />
          </div>
        </div>

        <p className="text-xs text-slate-400 mt-8 text-center">
          Want a platform we don&apos;t support yet?{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=Integration%20request`}
            className="text-blue-600 hover:underline"
          >
            Let us know
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function ComingSoonCard({
  icon,
  name,
  subtitle,
}: {
  icon: string;
  name: string;
  subtitle: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 opacity-60">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">{icon}</span>
          <h3 className="text-base font-bold text-slate-900 m-0">{name}</h3>
        </div>
        <span className="text-[11px] font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-1">
          Coming soon
        </span>
      </div>
      <p className="text-xs text-slate-500 m-0">{subtitle}</p>
    </div>
  );
}
