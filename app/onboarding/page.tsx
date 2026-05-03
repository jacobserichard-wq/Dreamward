"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const INDUSTRIES = [
  { id: "marketplace", label: "Market Vendor / Craft Seller", icon: "\u{1F3EA}" },
  { id: "freelance", label: "Freelancer / Consultant", icon: "\u{1F4BC}" },
  { id: "service", label: "Landscaping / Service Co", icon: "\u{1F333}" },
  { id: "food", label: "Food Truck / Mobile Business", icon: "\u{1F69A}" },
  { id: "ecommerce", label: "Etsy / Amazon FBA Seller", icon: "\u{1F4E6}" },
  { id: "creative", label: "Photographer / Creative", icon: "\u{1F3A8}" },
  { id: "bookkeeper", label: "Bookkeeper / Small CPA Firm", icon: "\u{1F4CA}" },
  { id: "nonprofit", label: "Nonprofit Organization", icon: "\u2764\uFE0F" },
  { id: "realestate", label: "Real Estate Investor", icon: "\u{1F3E0}" },
  { id: "fitness", label: "Personal Trainer / Coach", icon: "\u{1F3CB}\uFE0F" },
  { id: "other", label: "Other", icon: "\u2699\uFE0F" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName: businessName.trim(), industry }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      router.push("/");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.container}>
      <div style={s.card}>
        {/* Step indicators */}
        <div style={s.steps}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              ...s.stepDot,
              background: i <= step ? "#3b82f6" : "#e2e8f0",
            }} />
          ))}
        </div>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div style={s.stepContent}>
            <div style={s.welcomeIcon}>{"\u26A1"}</div>
            <h1 style={s.title}>Welcome to FlowWork</h1>
            <p style={s.subtitle}>
              AI-powered accounting automation for your small business.
              Let's get you set up in under a minute.
            </p>
            <button onClick={() => setStep(1)} style={s.primaryBtn}>
              Get started
            </button>
          </div>
        )}

        {/* Step 1: Business Name */}
        {step === 1 && (
          <div style={s.stepContent}>
            <h2 style={s.stepTitle}>What's your business called?</h2>
            <p style={s.stepSubtitle}>This helps us personalize your experience.</p>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Meridian Supply Co."
              style={s.input}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && businessName.trim()) setStep(2);
              }}
            />
            <div style={s.btnRow}>
              <button onClick={() => setStep(0)} style={s.backBtn}>Back</button>
              <button
                onClick={() => {
                  if (!businessName.trim()) {
                    setError("Please enter your business name");
                    return;
                  }
                  setError(null);
                  setStep(2);
                }}
                style={s.primaryBtn}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Industry */}
        {step === 2 && (
          <div style={s.stepContent}>
            <h2 style={s.stepTitle}>What type of business do you run?</h2>
            <p style={s.stepSubtitle}>We'll tailor your categories and features.</p>
            <div style={s.industryGrid}>
              {INDUSTRIES.map((ind) => (
                <button
                  key={ind.id}
                  onClick={() => setIndustry(ind.id)}
                  style={{
                    ...s.industryBtn,
                    ...(industry === ind.id ? s.industryBtnActive : {}),
                  }}
                >
                  <span style={s.industryIcon}>{ind.icon}</span>
                  <span style={s.industryLabel}>{ind.label}</span>
                </button>
              ))}
            </div>
            <div style={s.btnRow}>
              <button onClick={() => setStep(1)} style={s.backBtn}>Back</button>
              <button
                onClick={handleComplete}
                disabled={saving || !industry}
                style={{
                  ...s.primaryBtn,
                  ...(saving || !industry ? { opacity: 0.5, cursor: "not-allowed" } : {}),
                }}
              >
                {saving ? "Setting up..." : "Launch FlowWork"}
              </button>
            </div>
          </div>
        )}

        {error && <div style={s.error}>{error}</div>}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #1e293b 0%, #334155 100%)",
    padding: 24,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    background: "white",
    borderRadius: 16,
    padding: "40px 36px",
    maxWidth: 560,
    width: "100%",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  },
  steps: {
    display: "flex",
    gap: 8,
    justifyContent: "center",
    marginBottom: 32,
  },
  stepDot: {
    width: 40,
    height: 4,
    borderRadius: 2,
    transition: "background 0.2s",
  },
  stepContent: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    textAlign: "center" as const,
  },
  welcomeIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: "#0f172a",
    margin: "0 0 12px",
  },
  subtitle: {
    fontSize: 16,
    color: "#64748b",
    margin: "0 0 32px",
    lineHeight: 1.5,
    maxWidth: 400,
  },
  stepTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: "#0f172a",
    margin: "0 0 8px",
  },
  stepSubtitle: {
    fontSize: 14,
    color: "#64748b",
    margin: "0 0 24px",
  },
  input: {
    width: "100%",
    padding: "14px 16px",
    fontSize: 16,
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    outline: "none",
    marginBottom: 24,
    boxSizing: "border-box" as const,
  },
  industryGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    width: "100%",
    marginBottom: 24,
  },
  industryBtn: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    background: "white",
    cursor: "pointer",
    fontSize: 13,
    color: "#334155",
    textAlign: "left" as const,
    transition: "all 0.15s",
  },
  industryBtnActive: {
    borderColor: "#3b82f6",
    background: "#eff6ff",
    color: "#1e40af",
    fontWeight: 600,
  },
  industryIcon: {
    fontSize: 18,
    flexShrink: 0,
  },
  industryLabel: {
    fontSize: 13,
    lineHeight: 1.3,
  },
  btnRow: {
    display: "flex",
    gap: 12,
    width: "100%",
  },
  primaryBtn: {
    flex: 1,
    padding: "14px 24px",
    borderRadius: 10,
    border: "none",
    background: "#3b82f6",
    color: "white",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 600,
  },
  backBtn: {
    padding: "14px 24px",
    borderRadius: 10,
    border: "1px solid #e2e8f0",
    background: "white",
    color: "#64748b",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 500,
  },
  error: {
    marginTop: 16,
    padding: "10px 16px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    color: "#991b1b",
    fontSize: 14,
    textAlign: "center" as const,
  },
};