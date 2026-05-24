"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Spinner from "../components/Spinner";
import ErrorBanner from "../components/ErrorBanner";
import { apiFetch } from "@/lib/apiFetch";

const INDUSTRIES = [
  { id: "marketplace", label: "Market Vendor / Craft Seller", icon: "\u{1F3EA}" },
  { id: "freelance", label: "Freelancer / Consultant", icon: "\u{1F4BC}" },
  { id: "service", label: "Landscaping / Service Co", icon: "\u{1F333}" },
  { id: "food", label: "Food Truck / Mobile Business", icon: "\u{1F69A}" },
  { id: "ecommerce", label: "Etsy / Amazon FBA Seller", icon: "\u{1F4E6}" },
  { id: "creative", label: "Photographer / Creative", icon: "\u{1F3A8}" },
  { id: "bookkeeper", label: "Bookkeeper / Small CPA Firm", icon: "\u{1F4CA}" },
  { id: "nonprofit", label: "Nonprofit Organization", icon: "❤️" },
  { id: "realestate", label: "Real Estate Investor", icon: "\u{1F3E0}" },
  { id: "fitness", label: "Personal Trainer / Coach", icon: "\u{1F3CB}️" },
  { id: "other", label: "Other", icon: "⚙️" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sub-session 23 hygiene step 4: returning-user guard. The dashboard
  // pushes incomplete users HERE, but a completed user who navigates
  // back to /onboarding directly (browser history, bookmark, retype URL)
  // would otherwise see step 0 again — confusing, no real harm but
  // bad UX. Check on mount; redirect to / if onboarding is already
  // complete. The render path below stays gated on `checking` so we
  // don't briefly flash step 0 before the redirect fires.
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const data = await apiFetch<{
          onboardingCompleted?: boolean;
        }>("/api/client");
        if (cancelled) return;
        if (data?.onboardingCompleted === true) {
          router.replace("/");
          return;
        }
      } catch {
        // Non-fatal — fall through to render the form. If /api/client
        // is failing the user has bigger problems than a misrouted
        // onboarding page.
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleComplete = async () => {
    if (!businessName.trim()) {
      setError("Please enter your business name");
      return;
    }
    if (!industry) {
      setError("Please select your industry");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const data = await apiFetch<{ plan: string }>("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName: businessName.trim(), industry }),
      });
      router.push(data.plan === "pro" ? "/welcome-pro" : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't complete onboarding");
      setSaving(false);
    }
  };

  if (checking) {
    // Brief loading state while the returning-user check resolves.
    // Avoids flashing step 0 before the router.replace fires.
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-700 p-4 sm:p-6 font-sans">
        <div className="bg-white rounded-2xl p-6 sm:py-10 sm:px-9 max-w-[560px] w-full text-center">
          <Spinner />
          <p className="text-sm text-slate-500 mt-4 m-0">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-700 p-4 sm:p-6 font-sans">
      <div className="bg-white rounded-2xl p-6 sm:py-10 sm:px-9 max-w-[560px] w-full shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
        {/* Step indicators */}
        <div className="flex gap-2 justify-center mb-8">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`w-10 h-1 rounded-sm transition-colors duration-200 ${
                i <= step ? "bg-blue-500" : "bg-slate-200"
              }`}
            />
          ))}
        </div>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className="flex flex-col items-center text-center">
            <div className="text-5xl mb-4">{"⚡"}</div>
            <h1 className="text-[28px] font-bold text-slate-900 m-0 mb-3">Welcome to FlowWork</h1>
            <p className="text-base text-slate-500 leading-normal max-w-[400px] m-0 mb-8">
              AI-powered accounting automation for your small business.
              Let&apos;s get you set up in under a minute.
            </p>
            <button
              onClick={() => setStep(1)}
              className="flex-1 py-3.5 px-6 rounded-[10px] border-0 bg-blue-500 text-white text-[15px] font-semibold cursor-pointer"
            >
              Get started
            </button>
          </div>
        )}

        {/* Step 1: Business Name */}
        {step === 1 && (
          <div className="flex flex-col items-center text-center">
            <h2 className="text-[22px] font-bold text-slate-900 m-0 mb-2">What&apos;s your business called?</h2>
            <p className="text-sm text-slate-500 m-0 mb-6">This helps us personalize your experience.</p>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Meridian Supply Co."
              className="w-full py-3.5 px-4 text-base border border-slate-200 rounded-[10px] outline-none mb-6 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && businessName.trim()) setStep(2);
              }}
            />
            <div className="flex gap-3 w-full">
              <button
                onClick={() => setStep(0)}
                className="py-3.5 px-6 rounded-[10px] border border-slate-200 bg-white text-slate-500 text-[15px] font-medium cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={() => {
                  if (!businessName.trim()) {
                    setError("Please enter your business name");
                    return;
                  }
                  setError(null);
                  setStep(2);
                }}
                className="flex-1 py-3.5 px-6 rounded-[10px] border-0 bg-blue-500 text-white text-[15px] font-semibold cursor-pointer"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Industry */}
        {step === 2 && (
          <div className="flex flex-col items-center text-center">
            <h2 className="text-[22px] font-bold text-slate-900 m-0 mb-2">What type of business do you run?</h2>
            <p className="text-sm text-slate-500 m-0 mb-6">We&apos;ll tailor your categories and features.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full mb-6">
              {INDUSTRIES.map((ind) => (
                <button
                  key={ind.id}
                  onClick={() => setIndustry(ind.id)}
                  className={`flex items-center gap-2.5 py-3 px-3.5 border rounded-[10px] cursor-pointer text-[13px] text-left transition-all duration-150 outline-none focus:ring-2 focus:ring-blue-500/30 ${
                    industry === ind.id
                      ? "border-blue-500 bg-blue-50 text-blue-800 font-semibold"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <span className="text-lg shrink-0">{ind.icon}</span>
                  <span className="leading-[1.3]">{ind.label}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-3 w-full">
              <button
                onClick={() => setStep(1)}
                className="py-3.5 px-6 rounded-[10px] border border-slate-200 bg-white text-slate-500 text-[15px] font-medium cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={handleComplete}
                disabled={saving || !industry}
                className="flex-1 py-3.5 px-6 rounded-[10px] border-0 bg-blue-500 text-white text-[15px] font-semibold cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving && <Spinner size={14} color="white" />}
                {saving ? "Setting up..." : "Launch FlowWork"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4">
            <ErrorBanner message={error} onDismiss={() => setError(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
