"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import Spinner from "../components/Spinner";
import ErrorBanner from "../components/ErrorBanner";
import { apiFetch } from "@/lib/apiFetch";

export default function WelcomeProPage() {
  const router = useRouter();
  const [checkingPlan, setCheckingPlan] = useState(true);
  const [businessName, setBusinessName] = useState<string>("");
  const [loadingSample, setLoadingSample] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setBusinessName(data.businessName || "");
        setCheckingPlan(false);
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
      <div style={s.container}>
        <div style={s.loadingState}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <Script src="https://assets.calendly.com/assets/external/widget.js" strategy="afterInteractive" />

      <div style={s.hero}>
        <div style={s.proBadge}>{"✨"} PRO</div>
        <h1 style={s.heroTitle}>
          Welcome to FlowWork Pro{businessName ? `, ${businessName}` : ""}!
        </h1>
        <p style={s.heroSubtitle}>
          Your white-glove onboarding starts now. Book a 30-minute call with our team
          to get every feature dialed in for your business.
        </p>
      </div>

      <div style={s.content}>
        <section style={s.section}>
          <h2 style={s.sectionTitle}>Your white-glove benefits</h2>
          <div style={s.benefitGrid}>
            <div style={s.benefitCard}>
              <div style={s.benefitIcon}>{"\u{1F4DE}"}</div>
              <h3 style={s.benefitTitle}>1:1 onboarding call</h3>
              <p style={s.benefitText}>
                A 30-minute walkthrough where we configure FlowWork around your specific
                workflow, accounting software, and tax situation.
              </p>
            </div>
            <div style={s.benefitCard}>
              <div style={s.benefitIcon}>{"\u{1F3AF}"}</div>
              <h3 style={s.benefitTitle}>Custom categories</h3>
              <p style={s.benefitText}>
                Build category structures that match your chart of accounts. We&apos;ll
                map your historical data on the call.
              </p>
            </div>
            <div style={s.benefitCard}>
              <div style={s.benefitIcon}>{"\u{1F4CA}"}</div>
              <h3 style={s.benefitTitle}>Tax-ready reports</h3>
              <p style={s.benefitText}>
                Schedule C and quarterly estimate prep — generated from your data, not
                cobbled together at year-end.
              </p>
            </div>
            <div style={s.benefitCard}>
              <div style={s.benefitIcon}>{"\u{1F680}"}</div>
              <h3 style={s.benefitTitle}>Priority support</h3>
              <p style={s.benefitText}>
                Direct line to our team. Most questions answered same-day, guaranteed
                under 24 hours.
              </p>
            </div>
          </div>
        </section>

        <section style={s.section}>
          <h2 style={s.sectionTitle}>Book your onboarding call</h2>
          <p style={s.sectionLead}>
            Pick a time that works. We&apos;ll send a calendar invite with the meeting link.
          </p>
          <div
            className="calendly-inline-widget"
            data-url="https://calendly.com/jacobse-richard/flowwork-pro-onboarding-call"
            style={{ minWidth: 320, height: 700 }}
          />
        </section>

        <section style={s.sampleSection}>
          <h2 style={s.sectionTitle}>Want to explore first?</h2>
          <p style={s.sectionLead}>
            We can load a set of realistic sample invoices and expenses tailored to your
            industry so you can click around the dashboard before adding real data.
          </p>
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
          <div style={s.btnRow}>
            <button
              onClick={handleLoadSample}
              disabled={loadingSample}
              style={{
                ...s.primaryBtn,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                ...(loadingSample ? { opacity: 0.5, cursor: "not-allowed" } : {}),
              }}
            >
              {loadingSample && <Spinner size={14} color="white" />}
              {loadingSample ? "Loading sample data..." : "Load sample data"}
            </button>
            <a href="/" style={s.skipLink}>
              Skip and start fresh {"→"}
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    background: "#f8fafc",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  loadingState: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#64748b",
    fontSize: 15,
  },
  hero: {
    background: "linear-gradient(135deg, #1e293b 0%, #334155 100%)",
    color: "white",
    padding: "64px 32px 56px",
    textAlign: "center" as const,
  },
  proBadge: {
    display: "inline-block",
    padding: "6px 14px",
    background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
    color: "white",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "1.5px",
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 38,
    fontWeight: 800,
    margin: "0 0 16px",
    lineHeight: 1.2,
  },
  heroSubtitle: {
    fontSize: 18,
    opacity: 0.85,
    margin: "0 auto",
    maxWidth: 640,
    lineHeight: 1.5,
  },
  content: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "48px 32px 80px",
  },
  section: { marginBottom: 56 },
  sectionTitle: {
    fontSize: 24,
    fontWeight: 700,
    color: "#0f172a",
    margin: "0 0 12px",
  },
  sectionLead: {
    fontSize: 15,
    color: "#64748b",
    margin: "0 0 24px",
    lineHeight: 1.5,
  },
  benefitGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 16,
  },
  benefitCard: {
    background: "white",
    padding: "24px 20px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
  },
  benefitIcon: {
    fontSize: 28,
    marginBottom: 12,
  },
  benefitTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "#0f172a",
    margin: "0 0 8px",
  },
  benefitText: {
    fontSize: 14,
    color: "#64748b",
    lineHeight: 1.5,
    margin: 0,
  },
  sampleSection: {
    background: "white",
    padding: "32px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
  },
  btnRow: {
    display: "flex",
    gap: 16,
    alignItems: "center",
    flexWrap: "wrap" as const,
  },
  primaryBtn: {
    padding: "12px 24px",
    borderRadius: 10,
    border: "none",
    background: "#3b82f6",
    color: "white",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 600,
  },
  skipLink: {
    color: "#64748b",
    fontSize: 14,
    textDecoration: "none",
    fontWeight: 500,
  },
};
