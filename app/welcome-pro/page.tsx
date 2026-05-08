"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import Spinner from "../components/Spinner";
import ErrorBanner from "../components/ErrorBanner";
import { apiFetch } from "@/lib/apiFetch";

const CALENDLY_URL =
  process.env.NEXT_PUBLIC_CALENDLY_URL ||
  "https://calendly.com/jacobse-richard/flowwork-pro-onboarding-call";

interface ClientIdentity {
  id: number;
  email: string;
  businessName: string | null;
}

function buildCalendlyHref(identity: ClientIdentity | null): string {
  if (!identity) return CALENDLY_URL;
  try {
    const url = new URL(CALENDLY_URL);
    url.searchParams.set("utm_source", "flowwork");
    url.searchParams.set("utm_content", String(identity.id));
    if (identity.email) url.searchParams.set("email", identity.email);
    if (identity.businessName) url.searchParams.set("name", identity.businessName);
    return url.toString();
  } catch {
    return CALENDLY_URL;
  }
}

export default function WelcomeProPage() {
  const router = useRouter();
  const [checkingPlan, setCheckingPlan] = useState(true);
  const [identity, setIdentity] = useState<ClientIdentity | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seenRecorded = useRef(false);

  const businessName = identity?.businessName || "";
  const calendlyHref = useMemo(() => buildCalendlyHref(identity), [identity]);

  useEffect(() => {
    async function loadClient() {
      try {
        const res = await fetch("/api/client");
        if (!res.ok) {
          router.replace("/");
          return;
        }
        const data = await res.json();
        if (data.plan !== "pro") {
          router.replace("/");
          return;
        }
        setIdentity({
          id: data.id,
          email: data.email,
          businessName: data.businessName ?? null,
        });
        setCheckingPlan(false);

        // Mark welcome page as seen so the dashboard's backstop banner
        // clears. Fire-and-forget — failures are logged, never block.
        if (!seenRecorded.current) {
          seenRecorded.current = true;
          fetch("/api/welcome-pro/seen", { method: "POST" }).catch((err) => {
            console.error("Failed to record welcome-pro visit:", err);
          });
        }
      } catch {
        router.replace("/");
      }
    }
    loadClient();
  }, [router]);

  const handleLoadSample = async () => {
    setLoadingSample(true);
    setError(null);
    try {
      await apiFetch("/api/sample-data", { method: "POST" });
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load sample data");
      setLoadingSample(false);
    }
  };

  if (checkingPlan) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="min-h-screen flex items-center justify-center text-slate-500 text-[15px]">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <Script
        src="https://assets.calendly.com/assets/external/widget.js"
        strategy="afterInteractive"
      />

      <div className="bg-gradient-to-br from-slate-800 to-slate-700 text-white text-center pt-12 px-4 pb-10 sm:pt-16 sm:px-8 sm:pb-14">
        <div className="inline-block py-1.5 px-3.5 bg-gradient-to-br from-amber-500 to-amber-600 text-white rounded-[20px] text-xs font-bold tracking-widest mb-4">
          {"✨"} PRO
        </div>
        <h1 className="text-2xl sm:text-4xl font-extrabold mb-4 leading-[1.2]">
          Welcome to FlowWork Pro{businessName ? `, ${businessName}` : ""}!
        </h1>
        <p className="text-lg text-white/85 mx-auto max-w-[640px] leading-normal m-0">
          Your white-glove onboarding starts now. Book a 30-minute call with our team
          to get every feature dialed in for your business.
        </p>
      </div>

      <div className="max-w-[1100px] mx-auto pt-12 px-4 pb-16 sm:px-8 sm:pb-20">
        <section className="mb-14">
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Your white-glove benefits</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white py-6 px-5 rounded-xl border border-slate-200">
              <div className="text-3xl mb-3">{"\u{1F4DE}"}</div>
              <h3 className="text-base font-bold text-slate-900 mb-2">1:1 onboarding call</h3>
              <p className="text-sm text-slate-500 leading-normal m-0">
                A 30-minute walkthrough where we configure FlowWork around your specific
                workflow, accounting software, and tax situation.
              </p>
            </div>
            <div className="bg-white py-6 px-5 rounded-xl border border-slate-200">
              <div className="text-3xl mb-3">{"\u{1F3AF}"}</div>
              <h3 className="text-base font-bold text-slate-900 mb-2">Custom categories</h3>
              <p className="text-sm text-slate-500 leading-normal m-0">
                Build category structures that match your chart of accounts. We&apos;ll
                map your historical data on the call.
              </p>
            </div>
            <div className="bg-white py-6 px-5 rounded-xl border border-slate-200">
              <div className="text-3xl mb-3">{"\u{1F4CA}"}</div>
              <h3 className="text-base font-bold text-slate-900 mb-2">Tax-ready reports</h3>
              <p className="text-sm text-slate-500 leading-normal m-0">
                Schedule C and quarterly estimate prep — generated from your data, not
                cobbled together at year-end.
              </p>
            </div>
            <div className="bg-white py-6 px-5 rounded-xl border border-slate-200">
              <div className="text-3xl mb-3">{"\u{1F680}"}</div>
              <h3 className="text-base font-bold text-slate-900 mb-2">Priority support</h3>
              <p className="text-sm text-slate-500 leading-normal m-0">
                Direct line to our team. Most questions answered same-day, guaranteed
                under 24 hours.
              </p>
            </div>
          </div>
        </section>

        <section className="mb-14">
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Book your onboarding call</h2>
          <p className="text-[15px] text-slate-500 mb-6 leading-normal">
            Pick a time that works. We&apos;ll send a calendar invite with the meeting link.
          </p>
          <div
            className="calendly-inline-widget min-w-[320px] h-[600px] sm:h-[700px]"
            data-url={calendlyHref}
          />
        </section>

        <section className="bg-white p-6 sm:p-8 rounded-xl border border-slate-200">
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Want to explore first?</h2>
          <p className="text-[15px] text-slate-500 mb-6 leading-normal">
            We can load a set of realistic sample invoices and expenses tailored to your
            industry so you can click around the dashboard before adding real data.
          </p>
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
          <div className="flex gap-4 items-center flex-wrap">
            <button
              onClick={handleLoadSample}
              disabled={loadingSample}
              className="py-3 px-6 rounded-[10px] border-0 bg-blue-500 text-white cursor-pointer text-[15px] font-semibold inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingSample && <Spinner size={14} color="white" />}
              {loadingSample ? "Loading sample data..." : "Load sample data"}
            </button>
            <a href="/" className="text-slate-500 text-sm no-underline font-medium">
              Skip and start fresh {"→"}
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
