// app/integrations/page.tsx
//
// Phase 8b commit 3 of 3 (commit 9 of Phase 8 overall).
//
// /integrations — the user-facing hub for connecting external
// platforms. v1 lists Shopify + Wix (live) + placeholder cards for
// upcoming platforms (Etsy, Square, WooCommerce) so users see the
// roadmap.
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
import ErrorBanner from "../components/ErrorBanner";
import ShopifyConnectionCard from "../components/ShopifyConnectionCard";
import WixConnectionCard from "../components/WixConnectionCard";

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
    const errParam = params.get("error");
    const upgrade = params.get("upgrade");
    // Auto-bind handoff from the Wix Dashboard Extension bridge page
    // (/wix-bridge). When a merchant clicks "Open FlowWork" in the
    // Wix-embedded iframe, they land here with this param + their
    // FlowWork session. We POST to /api/wix/bind to finish the
    // connection, then show success/failure via the existing
    // banner plumbing.
    const wixBindInstance = params.get("wix_bind_instance");

    if (connected === "1" && shop) {
      setSuccessMsg(`Connected to ${shop}!`);
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
    }

    if (
      connected ||
      connectedWix ||
      errParam ||
      upgrade ||
      wixBindInstance
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

  // Non-Pro: upgrade card (mirrors /reports pattern from Phase 7a)
  if (plan !== "pro") {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/dashboard"
            backLabel="FlowWork"
            title="Integrations"
            subtitle="Connect your online store, payment processor, and other revenue sources"
          />
          <div className="bg-amber-50 border border-amber-200 rounded-xl py-8 px-6 text-center">
            <p className="text-base font-medium text-amber-900 m-0 mb-2">
              {"\u{1F512}"} Integrations are a Pro feature
            </p>
            <p className="text-sm text-amber-800 m-0 mb-5 leading-relaxed max-w-md mx-auto">
              Upgrade to Pro ($89/mo) to connect Shopify or Wix and
              pull orders + revenue automatically into FlowWork.
              Coming soon: Etsy, Square, WooCommerce.
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
      <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/dashboard"
          backLabel="FlowWork"
          title="Integrations"
          subtitle="Connect your online store, payment processor, and other revenue sources"
        />

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
            <ShopifyConnectionCard />
            <WixConnectionCard />
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
            <ComingSoonCard
              icon={"\u{1F3F7}\u{FE0F}"}
              name="Etsy"
              subtitle="Sync orders + listing fees + shop payments"
            />
            <ComingSoonCard
              icon={"\u{1F4B3}"}
              name="Square"
              subtitle="In-person POS + online commerce + payouts"
            />
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
            href="mailto:hello@flowworks.it.com?subject=Integration%20request"
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
