"use client";

import { useState, useEffect } from "react";

const ALL_MODULES = [
  { id: "invoices", label: "Invoices", description: "Track and process vendor invoices from email", icon: "\u{1F4D1}" },
  { id: "expenses", label: "Expenses", description: "Categorize and manage business expenses", icon: "\u{1F4B3}" },
  { id: "ar", label: "AR Follow-Up", description: "Track accounts receivable and send reminders", icon: "\u{1F514}", minPlan: "growth" },
  { id: "events", label: "Events and Sales", description: "Log revenue per market day or event", icon: "\u{1F3EA}", minPlan: "growth" },
  { id: "mileage", label: "Mileage Tracking", description: "Track trips and calculate IRS deductions", icon: "\u{1F697}", minPlan: "growth" },
  { id: "exports", label: "CSV/PDF Exports", description: "Export data for your CPA or records", icon: "\u{1F4E4}", minPlan: "growth" },
  { id: "custom_categories", label: "Custom Categories", description: "Create your own expense categories", icon: "\u{1F3F7}\uFE0F", minPlan: "pro" },
  { id: "tax_reports", label: "Tax Reports", description: "Schedule C mapping and quarterly estimates", icon: "\u{1F4CA}", minPlan: "pro" },
];

const DEFAULT_CATEGORIES = ["Supplies", "Booth Fees", "Travel/Gas", "Packaging", "Marketing", "Other"];
const PLAN_RANK: Record<string, number> = { trial: 0, starter: 1, growth: 2, pro: 3 };

export default function SettingsPage() {
  const [plan, setPlan] = useState("trial");
  const [activeModules, setActiveModules] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [catSaving, setCatSaving] = useState(false);
  const [catSaved, setCatSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = await res.json();
        setPlan(data.plan);
        setActiveModules(data.settings?.active_modules || ["invoices", "expenses"]);
        setCategories(data.settings?.custom_categories || DEFAULT_CATEGORIES);
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

  const addCategory = () => {
    const trimmed = newCategory.trim();
    if (!trimmed) return;
    if (categories.includes(trimmed)) return;
    setCategories((prev) => [...prev, trimmed]);
    setNewCategory("");
    setCatSaved(false);
  };

  const removeCategory = (cat: string) => {
    setCategories((prev) => prev.filter((c) => c !== cat));
    setCatSaved(false);
  };

  const resetCategories = () => {
    setCategories([...DEFAULT_CATEGORIES]);
    setCatSaved(false);
  };

  const saveCategories = async () => {
    setCatSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customCategories: categories }),
      });
      if (res.ok) setCatSaved(true);
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setCatSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={st.container}>
        <div style={st.content}>
          <p style={{ textAlign: "center" as const, padding: 60, color: "#64748b" }}>Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={st.container}>
      <div style={st.content}>
        <div style={st.header}>
          <a href="/" style={st.backLink}>{"\u2190 Back to FlowWork"}</a>
          <h1 style={st.title}>Settings</h1>
          <p style={st.subtitle}>Manage your modules and preferences</p>
        </div>

        {/* Module Toggles */}
        <div style={st.section}>
          <div style={st.sectionHeader}>
            <h2 style={st.sectionTitle}>Active Modules</h2>
            <p style={st.sectionSubtitle}>Enable or disable features for your workspace</p>
          </div>

          <div style={st.moduleGrid}>
            {ALL_MODULES.map((mod) => {
              const isActive = activeModules.includes(mod.id);
              const minRank = PLAN_RANK[mod.minPlan || "trial"] || 0;
              const userRank = PLAN_RANK[plan] || 0;
              const isLocked = userRank < minRank;

              return (
                <div
                  key={mod.id}
                  style={{
                    ...st.moduleCard,
                    ...(isActive && !isLocked ? st.moduleCardActive : {}),
                    ...(isLocked ? st.moduleCardLocked : {}),
                  }}
                  onClick={() => { if (!isLocked) toggleModule(mod.id); }}
                >
                  <div style={st.moduleTop}>
                    <span style={st.moduleIcon}>{mod.icon}</span>
                    <div style={{
                      ...st.toggle,
                      ...(isActive && !isLocked ? st.toggleOn : {}),
                      ...(isLocked ? st.toggleLocked : {}),
                    }}>
                      <div style={{
                        ...st.toggleDot,
                        ...(isActive && !isLocked ? st.toggleDotOn : {}),
                      }} />
                    </div>
                  </div>
                  <div style={st.moduleLabel}>{mod.label}</div>
                  <div style={st.moduleDesc}>{mod.description}</div>
                  {isLocked && (
                    <div style={st.lockBadge}>
                      {mod.minPlan === "growth" ? "Growth+ plan required" : "Pro plan required"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={st.saveRow}>
            <button onClick={saveModules} disabled={saving} style={{...st.saveBtn, ...(saving ? { opacity: 0.5 } : {})}}>
              {saving ? "Saving..." : "Save changes"}
            </button>
            {saved && <span style={st.savedMsg}>{"\u2713 Saved"}</span>}
          </div>
        </div>

        {/* Expense Categories */}
        <div style={st.section}>
          <div style={st.sectionHeader}>
            <h2 style={st.sectionTitle}>Expense Categories</h2>
            <p style={st.sectionSubtitle}>Customize how your expenses are organized</p>
          </div>

          <div style={st.catCard}>
            <div style={st.catList}>
              {categories.map((cat) => (
                <div key={cat} style={st.catItem}>
                  <span style={st.catName}>{cat}</span>
                  <button
                    onClick={() => removeCategory(cat)}
                    style={st.catRemoveBtn}
                    title="Remove category"
                  >
                    {"\u2715"}
                  </button>
                </div>
              ))}
            </div>

            <div style={st.catAddRow}>
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Add new category..."
                style={st.catInput}
                onKeyDown={(e) => { if (e.key === "Enter") addCategory(); }}
              />
              <button onClick={addCategory} style={st.catAddBtn}>Add</button>
            </div>

            <div style={st.catActions}>
              <button onClick={saveCategories} disabled={catSaving} style={{...st.saveBtn, ...(catSaving ? { opacity: 0.5 } : {})}}>
                {catSaving ? "Saving..." : "Save categories"}
              </button>
              {catSaved && <span style={st.savedMsg}>{"\u2713 Saved"}</span>}
              <button onClick={resetCategories} style={st.resetBtn}>Reset to defaults</button>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div style={st.linksRow}>
          <a href="/billing" style={st.linkCard}>
            <span style={{ fontSize: 20 }}>{"\u{1F4B3}"}</span>
            <span>Billing and Plan</span>
          </a>
          <a href="/onboarding" style={st.linkCard}>
            <span style={{ fontSize: 20 }}>{"\u{1F3E2}"}</span>
            <span>Re-run Onboarding</span>
          </a>
        </div>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
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
  moduleCard: { background: "white", borderRadius: 12, border: "2px solid #e2e8f0", padding: "16px 18px", cursor: "pointer", transition: "all 0.15s" },
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

  catCard: { background: "white", borderRadius: 12, border: "1px solid #e2e8f0", padding: "20px 24px" },
  catList: { display: "flex", flexWrap: "wrap" as const, gap: 8, marginBottom: 16 },
  catItem: { display: "flex", alignItems: "center", gap: 6, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 20, padding: "6px 12px" },
  catName: { fontSize: 13, fontWeight: 500, color: "#166534" },
  catRemoveBtn: { background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#94a3b8", padding: "0 2px", lineHeight: 1 },
  catAddRow: { display: "flex", gap: 8, marginBottom: 16 },
  catInput: { flex: 1, padding: "10px 14px", fontSize: 14, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none", boxSizing: "border-box" as const },
  catAddBtn: { padding: "10px 20px", borderRadius: 8, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", fontSize: 14, fontWeight: 500, color: "#334155" },
  catActions: { display: "flex", alignItems: "center", gap: 12 },
  resetBtn: { padding: "10px 20px", borderRadius: 8, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", fontSize: 13, color: "#64748b" },

  linksRow: { display: "flex", gap: 12 },
  linkCard: { flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", background: "white", borderRadius: 12, border: "1px solid #e2e8f0", textDecoration: "none", color: "#334155", fontSize: 14, fontWeight: 500 },
};
