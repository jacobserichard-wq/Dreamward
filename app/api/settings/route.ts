"use client";

import { useState, useEffect } from "react";

const ALL_MODULES = [
  { id: "invoices", label: "Invoices", description: "Track and process vendor invoices from email", icon: "\u{1F4D1}" },
  { id: "expenses", label: "Expenses", description: "Categorize and manage business expenses", icon: "\u{1F4B3}" },
  { id: "ar", label: "AR Follow-Up", description: "Track accounts receivable and send reminders", icon: "\u{1F514}", minPlan: "growth" },
  { id: "events", label: "Events & Sales", description: "Log revenue per market day or event", icon: "\u{1F3EA}", minPlan: "growth" },
  { id: "mileage", label: "Mileage Tracking", description: "Track trips and calculate IRS deductions", icon: "\u{1F697}", minPlan: "growth" },
  { id: "exports", label: "CSV/PDF Exports", description: "Export data for your CPA or records", icon: "\u{1F4E4}", minPlan: "growth" },
  { id: "custom_categories", label: "Custom Categories", description: "Create your own expense categories", icon: "\u{1F3F7}\uFE0F", minPlan: "pro" },
  { id: "tax_reports", label: "Tax Reports", description: "Schedule C mapping and quarterly estimates", icon: "\u{1F4CA}", minPlan: "pro" },
];

const PLAN_RANK: Record<string, number> = { trial: 0, starter: 1, growth: 2, pro: 3 };

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [plan, setPlan] = useState("trial");
  const [activeModules, setActiveModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = await res.json();
        setSettings(data.settings);
        setPlan(data.plan);
        setActiveModules(data.settings?.active_modules || ["invoices", "expenses"]);
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const toggleModule = (moduleId: string) => {
    setActiveModules((prev) =>
      prev.includes(moduleId)
        ? prev.filter((m) => m !== moduleId)
        : [...prev, moduleId]
    );
    setSaved(false);
  };

  const saveModules = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeModules }),
      });
      if (res.ok) setSaved(true);
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={s.container}>
        <div style={s.content}>
          <p style={{ textAlign: "center", padding: 60, color: "#64748b" }}>Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <div style={s.content}>
        <div style={s.header}>
          <a href="/" style={s.backLink}>{"\u2190"} Back to FlowWork</a>
          <h1 style={s.title}>Settings</h1>
          <p style={s.subtitle}>Manage your modules and preferences</p>
        </div>

        {/* Module Toggles */}
        <div style={s.section}>
          <div style={s.sectionHeader}>
            <h2 style={s.sectionTitle}>Active Modules</h2>
            <p style={s.sectionSubtitle}>Enable or disable features for your workspace</p>
          </div>

          <div style={s.moduleGrid}>
            {ALL_MODULES.map((mod) => {
              const isActive = activeModules.includes(mod.id);
              const minRank = PLAN_RANK[mod.minPlan || "trial"] || 0;
              const userRank = PLAN_RANK[plan] || 0;
              const isLocked = userRank < minRank;

              return (
                <div
                  key={mod.id}
                  style={{
                    ...s.moduleCard,
                    ...(isActive && !isLocked ? s.moduleCardActive : {}),
                    ...(isLocked ? s.moduleCardLocked : {}),
                  }}
                  onClick={() => !isLocked && toggleModule(mod.id)}
                >
                  <div style={s.moduleTop}>
                    <span style={s.moduleIcon}>{mod.icon}</span>
                    <div style={{
                      ...s.toggle,
                      ...(isActive && !isLocked ? s.toggleOn : {}),
                      ...(isLocked ? s.toggleLocked : {}),
                    }}>
                      <div style={{
                        ...s.toggleDot,
                        ...(isActive && !isLocked ? s.toggleDotOn : {}),
                      }} />
                    </div>
                  </div>
                  <div style={s.moduleLabel}>{mod.label}</div>
                  <div style={s.moduleDesc}>{mod.description}</div>
                  {isLocked && (
                    <div style={s.lockBadge}>
                      {mod.minPlan === "growth" ? "Growth+" : "Pro"} plan required
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={s.saveRow}>
            <button
              onClick={saveModules}
              disabled={saving}
              style={{
                ...s.saveBtn,
                ...(saving ? { opacity: 0.5 } : {}),
              }}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
            {saved && <span style={s.savedMsg}>{"\u2713"} Saved</span>}
          </div>
        </div>

        {/* Quick Links */}
        <div style={s.linksRow}>
          <a href="/billing" style={s.linkCard}>
            <span style={s.linkIcon}>{"\u{1F4B3}"}</span>
            <span>Billing & Plan</span>
          </a>
          <a href="/onboarding" style={s.linkCard}>
            <span style={s.linkIcon}>{"\u{1F3E2}"}</span>
            <span>Re-run Onboarding</span>
          </a>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { minHeight: "100vh", background: "#f8fafc", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  content: { maxWidth: 800, margin: "0 auto", padding: "32px 24px" },
  header: { marginBottom: 32 },
  backLink: { fontSize: 14, color: "#3b82f6", textDecoration: "none", display: "inline-block", marginBottom: 12 },
  title: { fontSize: 28, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" },
  subtitle: { fontSize: 14, color: "#64748b", margin: 0 },

  section: { marginBottom: 40 },
  sectionHeader: { marginBottom: 20 },
  sectionTitle: { fontSize: 18, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" },
  sectionSubtitle: { fontSize: 14, color: "#64748b", margin: 0 },

  moduleGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 },
  moduleCard: {
    background: "white",
    borderRadius: 12,
    border: "2px solid #e2e8f0",
    padding: "16px 18px",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  moduleCardActive: { borderColor: "#3b82f6", background: "#f8faff" },
  moduleCardLocked: { opacity: 0.6, cursor: "not-allowed", background: "#f8fafc" },
  moduleTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  moduleIcon: { fontSize: 22 },
  moduleLabel: { fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 4 },
  moduleDesc: { fontSize: 12, color: "#64748b", lineHeight: 1.4 },

  toggle: { width: 36, height: 20, borderRadius: 10, background: "#e2e8f0", position: "relative" as const, transition: "background 0.2s" },
  toggleOn: { background: "#3b82f6" },
  toggleLocked: { background: "#f1f5f9" },
  toggleDot: { width: 16, height: 16, borderRadius: 8, background: "white", position: "absolute" as const, top: 2, left: 2, transition: "left 0.2s", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" },
  toggleDotOn: { left: 18 },

  lockBadge: { marginTop: 8, fontSize: 11, color: "#64748b", background: "#f1f5f9", padding: "3px 8px", borderRadius: 4, display: "inline-block" },

  saveRow: { display: "flex", alignItems: "center", gap: 12, marginTop: 20 },
  saveBtn: { padding: "10px 24px", borderRadius: 8, border: "none", background: "#3b82f6", color: "white", cursor: "pointer", fontSize: 14, fontWeight: 600 },
  savedMsg: { fontSize: 14, color: "#16a34a", fontWeight: 500 },

  linksRow: { display: "flex", gap: 12 },
  linkCard: { flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", background: "white", borderRadius: 12, border: "1px solid #e2e8f0", textDecoration: "none", color: "#334155", fontSize: 14, fontWeight: 500 },
  linkIcon: { fontSize: 20 },
};