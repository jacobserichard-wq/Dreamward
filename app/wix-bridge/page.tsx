// app/wix-bridge/page.tsx
//
// Phase 10 Dashboard Extension commit 2 of 3. The public iframe page
// that Wix renders inside the merchant's Wix dashboard.
//
// ─────────────────────────────────────────────────────────────────
// How Wix calls this page:
// ─────────────────────────────────────────────────────────────────
// When a merchant clicks the FlowWork widget in their Wix dashboard,
// Wix loads:
//     https://flowworks.it.com/wix-bridge?instance=<JWT>
// where <JWT> is a Wix-signed token containing the instance info.
// Per Wix docs:
//   - param name is "instance"
//   - value is an RS256-signed JWT
//   - payload contains instanceId + other fields
//
// We decode the JWT client-side (no signature verify — that happens
// server-side in /api/wix/bind via mintAccessToken which calls Wix's
// own API). Extract the instanceId UUID, then provide a button that
// opens FlowWork in a new tab with the UUID as a query param.
//
// ─────────────────────────────────────────────────────────────────
// Why a "open in new tab" button instead of binding directly:
// ─────────────────────────────────────────────────────────────────
// This iframe is third-party from FlowWork's perspective (loaded by
// manage.wix.com). NextAuth session cookies aren't reliably available
// in third-party iframe contexts due to browser cookie restrictions.
// So we punt: the iframe just shows a "click here" button → opens
// flowworks.it.com/integrations in a new tab where FlowWork is
// first-party + has full session + does the bind via /api/wix/bind.
//
// Public route — must NOT be added to proxy.ts auth matcher. The
// iframe has no FlowWork session by design.
//
// Headers in next.config.ts allow this route to be embedded by
// manage.wix.com (CSP frame-ancestors).

"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

// Wrap inner component in Suspense — useSearchParams requires it for
// static rendering (Next 15+ pattern, same as /integrations).
export default function WixBridgePage() {
  return (
    <Suspense fallback={<BridgeLoading />}>
      <WixBridgeInner />
    </Suspense>
  );
}

function BridgeLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans p-6">
      <p className="text-sm text-slate-500">Loading…</p>
    </div>
  );
}

interface DecodedInstance {
  instanceId?: string;
  appDefId?: string;
  // Wix puts a lot in here; we only care about instanceId. Other
  // fields (siteOwnerId, signDate, vendorProductId, etc.) are
  // available but not used.
  [key: string]: unknown;
}

/**
 * Decode the payload of a JWT without verifying the signature.
 * Signature verification happens server-side when /api/wix/bind
 * mints a Client Credentials token against Wix's API (which fails
 * for any invalid instanceId — that's our real validation).
 */
function decodeJwtPayloadUnsafe(jwt: string): DecodedInstance | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    // base64url → base64 → atob
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as DecodedInstance;
  } catch {
    return null;
  }
}

function WixBridgeInner() {
  const params = useSearchParams();
  const [hostOrigin, setHostOrigin] = useState("https://flowworks.it.com");

  // Determine FlowWork's origin so the "Open" button works in dev too.
  useEffect(() => {
    if (typeof window !== "undefined") {
      setHostOrigin(window.location.origin);
    }
  }, []);

  // Try the documented param name first, then fall back to common
  // alternatives in case Wix's encoding changes.
  const rawInstance = useMemo(() => {
    return (
      params.get("instance") ||
      params.get("instanceId") ||
      params.get("instance_id") ||
      ""
    );
  }, [params]);

  const decoded = useMemo(() => {
    if (!rawInstance) return null;
    // If it looks like a JWT (three dot-separated segments), decode.
    // Otherwise treat the raw value as a UUID directly.
    if (rawInstance.includes(".") && rawInstance.split(".").length === 3) {
      return decodeJwtPayloadUnsafe(rawInstance);
    }
    // Looks like a raw UUID
    if (/^[0-9a-f-]{36}$/i.test(rawInstance)) {
      return { instanceId: rawInstance } as DecodedInstance;
    }
    return null;
  }, [rawInstance]);

  const instanceId = decoded?.instanceId ?? null;

  const flowworkUrl = useMemo(() => {
    if (!instanceId) return null;
    const u = new URL("/integrations", hostOrigin);
    u.searchParams.set("wix_bind_instance", instanceId);
    return u.toString();
  }, [instanceId, hostOrigin]);

  // ── Error states ────────────────────────────────────────────
  if (!rawInstance) {
    return (
      <PageFrame>
        <h1 className="text-base font-bold text-slate-900 m-0 mb-2">
          {"\u{1F3D7}\u{FE0F}"} FlowWork
        </h1>
        <p className="text-sm text-slate-700 m-0 mb-2">
          This page is meant to load inside your Wix dashboard.
        </p>
        <p className="text-xs text-slate-500 m-0">
          Visit{" "}
          <a
            href={hostOrigin}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            flowworks.it.com
          </a>{" "}
          directly to manage your account.
        </p>
      </PageFrame>
    );
  }

  if (!instanceId) {
    return (
      <PageFrame>
        <h1 className="text-base font-bold text-slate-900 m-0 mb-2">
          {"\u{26A0}\u{FE0F}"} Couldn&apos;t read the install info
        </h1>
        <p className="text-sm text-slate-700 m-0 mb-3 leading-relaxed">
          We got an instance token from Wix, but couldn&apos;t decode it.
          This might be a temporary issue. Try refreshing this page, or
          contact{" "}
          <a
            href="mailto:hello@flowworks.it.com"
            className="text-blue-600 hover:underline"
          >
            hello@flowworks.it.com
          </a>{" "}
          if it keeps happening.
        </p>
      </PageFrame>
    );
  }

  // ── Happy path ──────────────────────────────────────────────
  return (
    <PageFrame>
      <h1 className="text-base font-bold text-slate-900 m-0 mb-2">
        {"\u{2728}"} Almost there!
      </h1>
      <p className="text-sm text-slate-700 m-0 mb-4 leading-relaxed">
        Click the button below to finish connecting your Wix site to
        FlowWork. You&apos;ll need to be signed in with your FlowWork
        Pro account.
      </p>
      <a
        href={flowworkUrl ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block py-2.5 px-5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold no-underline cursor-pointer"
      >
        Open FlowWork to finish connecting →
      </a>
      <p className="text-xs text-slate-400 m-0 mt-3">
        Don&apos;t have a FlowWork account?{" "}
        <a
          href={`${hostOrigin}/signin`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          Sign up first
        </a>
        , then come back and click the button above.
      </p>
    </PageFrame>
  );
}

// Visual wrapper. Keeps the iframe content centered + comfortable
// at narrow widths since Wix's iframe chrome can be quite small.
function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans p-6">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}
