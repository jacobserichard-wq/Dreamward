"use client";

import { useState, useEffect } from "react";
import PageHeader from "../components/PageHeader";

const ALL_MODULES = [
  { id: "invoices", label: "Invoices", description: "Track and process vendor invoices from email", icon: "\u{1F4D1}" },
  { id: "expenses", label: "Expenses", description: "Categorize and manage business expenses", icon: "\u{1F4B3}" },
  { id: "ar", label: "AR Follow-Up", description: "Track accounts receivable and send reminders", icon: "\u{1F514}", minPlan: "growth" },
  { id: "events", label: "Events and Sales", description: "Log revenue per market day or event", icon: "\u{1F3EA}", minPlan: "growth" },
  { id: "mileage", label: "Mileage Tracking", description: "Track trips and calculate IRS deductions", icon: "\u{1F697}", minPlan: "growth" },
  { id: "exports", label: "CSV/PDF Exports", description: "Export data for your CPA or records", icon: "\u{1F4E4}", minPlan: "growth" },
  { id: "custom_categories", label: "Custom Categories", description: "Create your own expense categories", icon: "\u{1F3F7}️", minPlan: "pro" },
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
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/"
          backLabel="FlowWork"
          title="Settings"
          subtitle="Manage your modules and preferences"
        />

        {/* Module Toggles */}
        <div className="mb-10">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-900 mb-1">Active Modules</h2>
            <p className="text-sm text-slate-500 m-0">Enable or disable features for your workspace</p>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {ALL_MODULES.map((mod) => {
              const isActive = activeModules.includes(mod.id);
              const minRank = PLAN_RANK[mod.minPlan || "trial"] || 0;
              const userRank = PLAN_RANK[plan] || 0;
              const isLocked = userRank < minRank;

              // Compose card classes per state — atomic Tailwind doesn't override
              // the way inline-style spreads do, so each state owns its full set
              // of conflicting utilities (border color, bg, opacity, cursor).
              const cardStateClasses = isLocked
                ? "border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed"
                : isActive
                ? "border-blue-500 bg-blue-50 cursor-pointer"
                : "border-slate-200 bg-white cursor-pointer";

              const toggleBgClass = isLocked
                ? "bg-slate-100"
                : isActive
                ? "bg-blue-500"
                : "bg-slate-200";

              return (
                <div
                  key={mod.id}
                  onClick={() => {
                    if (!isLocked) toggleModule(mod.id);
                  }}
                  className={`rounded-xl border-2 py-4 px-[18px] transition duration-150 ${cardStateClasses}`}
                >
                  <div className="flex justify-between items-center mb-2.5">
                    <span className="text-[22px]">{mod.icon}</span>
                    <div
                      className={`relative w-9 h-5 rounded-full transition-[background-color] duration-200 ${toggleBgClass}`}
                    >
                      <div
                        className={`absolute w-4 h-4 rounded-full bg-white top-0.5 transition-[left] duration-200 shadow-sm ${
                          isActive && !isLocked ? "left-[18px]" : "left-0.5"
                        }`}
                      />
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-slate-900 mb-1">{mod.label}</div>
                  <div className="text-xs text-slate-500 leading-snug">{mod.description}</div>
                  {isLocked && (
                    <div className="mt-2 text-[11px] text-slate-500 bg-slate-100 py-[3px] px-2 rounded inline-block">
                      {mod.minPlan === "growth" ? "Growth+ plan required" : "Pro plan required"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={saveModules}
              disabled={saving}
              className={`py-2.5 px-6 rounded-lg border-0 bg-blue-500 text-white cursor-pointer text-sm font-semibold ${
                saving ? "opacity-50" : ""
              }`}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
            {saved && <span className="text-sm text-green-600 font-medium">{"✓ Saved"}</span>}
          </div>
        </div>

        {/* Expense Categories */}
        <div className="mb-10">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-900 mb-1">Expense Categories</h2>
            <p className="text-sm text-slate-500 m-0">Customize how your expenses are organized</p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            <div className="flex flex-wrap gap-2 mb-4">
              {categories.map((cat) => (
                <div
                  key={cat}
                  className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-[20px] py-1.5 px-3"
                >
                  <span className="text-[13px] font-medium text-green-800">{cat}</span>
                  <button
                    onClick={() => removeCategory(cat)}
                    title="Remove category"
                    className="bg-transparent border-0 cursor-pointer text-xs text-slate-400 px-0.5 py-0 leading-none"
                  >
                    {"✕"}
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Add new category..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") addCategory();
                }}
                className="flex-1 py-2.5 px-3.5 text-sm border border-slate-200 rounded-lg outline-none box-border"
              />
              <button
                onClick={addCategory}
                className="py-2.5 px-5 rounded-lg border border-slate-200 bg-white cursor-pointer text-sm font-medium text-slate-700"
              >
                Add
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={saveCategories}
                disabled={catSaving}
                className={`py-2.5 px-6 rounded-lg border-0 bg-blue-500 text-white cursor-pointer text-sm font-semibold ${
                  catSaving ? "opacity-50" : ""
                }`}
              >
                {catSaving ? "Saving..." : "Save categories"}
              </button>
              {catSaved && <span className="text-sm text-green-600 font-medium">{"✓ Saved"}</span>}
              <button
                onClick={resetCategories}
                className="py-2.5 px-5 rounded-lg border border-slate-200 bg-white cursor-pointer text-[13px] text-slate-500"
              >
                Reset to defaults
              </button>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div className="flex gap-3">
          <a
            href="/billing"
            className="flex-1 flex items-center gap-2.5 py-4 px-5 bg-white rounded-xl border border-slate-200 no-underline text-slate-700 text-sm font-medium"
          >
            <span className="text-xl">{"\u{1F4B3}"}</span>
            <span>Billing and Plan</span>
          </a>
          <a
            href="/onboarding"
            className="flex-1 flex items-center gap-2.5 py-4 px-5 bg-white rounded-xl border border-slate-200 no-underline text-slate-700 text-sm font-medium"
          >
            <span className="text-xl">{"\u{1F3E2}"}</span>
            <span>Re-run Onboarding</span>
          </a>
        </div>
      </div>
    </div>
  );
}
