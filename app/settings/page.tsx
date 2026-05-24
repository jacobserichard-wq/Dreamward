"use client";

import { useState, useEffect, useMemo } from "react";
import PageHeader from "../components/PageHeader";

const ALL_MODULES = [
  { id: "invoices", label: "Invoices", description: "Track and process vendor invoices from email", icon: "\u{1F4D1}" },
  { id: "expenses", label: "Expenses", description: "Categorize and manage business expenses", icon: "\u{1F4B3}" },
  { id: "ar", label: "AR Follow-Up", description: "Track accounts receivable and send reminders", icon: "\u{1F514}", minPlan: "growth" },
  { id: "events", label: "Events and Sales", description: "Log revenue per market day or event", icon: "\u{1F3EA}", minPlan: "growth" },
  { id: "mileage", label: "Mileage Tracking", description: "Track trips and calculate IRS deductions", icon: "\u{1F697}", minPlan: "growth" },
  { id: "exports", label: "CSV/PDF Exports", description: "Export data for your CPA or records", icon: "\u{1F4E4}", minPlan: "growth" },
  { id: "custom_categories", label: "Custom Categories", description: "Create your own expense categories", icon: "\u{1F3F7}️" },
  { id: "tax_reports", label: "Tax Reports", description: "Schedule C mapping and quarterly estimates", icon: "\u{1F4CA}", minPlan: "pro" },
];

const PLAN_RANK: Record<string, number> = { trial: 0, starter: 1, growth: 2, pro: 3 };

export default function SettingsPage() {
  const [plan, setPlan] = useState("trial");
  const [industry, setIndustry] = useState<string | null>(null);
  const [industryDefaults, setIndustryDefaults] = useState<string[]>([]);
  const [activeModules, setActiveModules] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [catSaving, setCatSaving] = useState(false);
  const [catSaved, setCatSaved] = useState(false);
  const [savedModules, setSavedModules] = useState<string[]>([]);
  const [savedCategories, setSavedCategories] = useState<string[]>([]);
  // Phase 4: home address — third dirty-tracked section (mirrors the
  // modules + categories pattern from sub-session 12.4).
  const [homeAddress, setHomeAddress] = useState("");
  const [savedHomeAddress, setSavedHomeAddress] = useState("");
  const [homeAddressSaving, setHomeAddressSaving] = useState(false);
  const [homeAddressSaved, setHomeAddressSaved] = useState(false);
  const [homeAddressRecomputeMsg, setHomeAddressRecomputeMsg] = useState<string | null>(null);

  // Phase 7a commit 5: CPA email — used by /api/reports/annual/send.
  // Persisted under preferences.cpa.email. Single optional string;
  // empty string saves as no-email (the JSONB merge drops the key by
  // assigning null/missing on save). Mirrors the home-address pattern
  // exactly: dirty state, saved indicator, disabled-when-clean button.
  // Phase 7c commit 8: tax bracket assumption for quarterly estimates.
  // Persisted under preferences.taxBracket = { incomePct, sePct }.
  // Defaults (22 income, 14.13 SE) mirror DEFAULT_TAX_BRACKET in
  // lib/quarterly.ts. Single dirty flag covers both inputs since they
  // save together via one PATCH.
  const [incomePct, setIncomePct] = useState<string>("22");
  const [sePct, setSePct] = useState<string>("14.13");
  const [savedIncomePct, setSavedIncomePct] = useState<string>("22");
  const [savedSePct, setSavedSePct] = useState<string>("14.13");
  const [bracketSaving, setBracketSaving] = useState(false);
  const [bracketSaved, setBracketSaved] = useState(false);
  const [bracketError, setBracketError] = useState<string | null>(null);

  const [cpaEmail, setCpaEmail] = useState("");
  const [savedCpaEmail, setSavedCpaEmail] = useState("");
  const [cpaEmailSaving, setCpaEmailSaving] = useState(false);
  const [cpaEmailSaved, setCpaEmailSaved] = useState(false);
  const [cpaEmailError, setCpaEmailError] = useState<string | null>(null);

  // Phase 4 commit 8: hide/un-hide industry-default categories. Persisted
  // under client_settings.preferences.hidden_industry_defaults: string[].
  // The full preferences object is round-tripped through PATCH so other
  // fields (none today, but future-proof) aren't clobbered.
  const [preferences, setPreferences] = useState<Record<string, unknown>>({});
  const [hiddenDefaults, setHiddenDefaults] = useState<string[]>([]);
  const [savedHiddenDefaults, setSavedHiddenDefaults] = useState<string[]>([]);
  const [showHiddenDefaults, setShowHiddenDefaults] = useState(false);
  const [hiddenDefaultsSaving, setHiddenDefaultsSaving] = useState(false);
  const [hiddenDefaultsSaved, setHiddenDefaultsSaved] = useState(false);

  // Phase 5 commit 8: custom income categories. Parallel to the existing
  // custom_categories (expense-typed). Without this list, a custom income
  // category like "Wholesale Orders" would be subtracted from revenue as
  // an expense in /api/profitability — fixed by Option 1 in sub-session 19.
  // Persisted under preferences.custom_income_categories: string[].
  const [incomeCategories, setIncomeCategories] = useState<string[]>([]);
  const [savedIncomeCategories, setSavedIncomeCategories] = useState<string[]>([]);
  const [newIncomeCategory, setNewIncomeCategory] = useState("");
  const [incomeCatSaving, setIncomeCatSaving] = useState(false);
  const [incomeCatSaved, setIncomeCatSaved] = useState(false);

  // Phase 5 commit 8: IRS mileage rate edit. The rate is federal (one row
  // in app_settings, not per-client) — any user editing it affects every
  // tenant's mileage math. rateSource tells us whether the loaded value
  // came from the table (config) or the API's hardcoded fallback (fallback)
  // so we can label the indicator honestly.
  const [irsRateInput, setIrsRateInput] = useState("");
  const [savedIrsRate, setSavedIrsRate] = useState<number>(0.7);
  const [irsRateSource, setIrsRateSource] = useState<"config" | "fallback">("fallback");
  const [irsRateSaving, setIrsRateSaving] = useState(false);
  const [irsRateSaved, setIrsRateSaved] = useState(false);
  const [irsRateError, setIrsRateError] = useState<string | null>(null);

  const hiddenDefaultsDirty = useMemo(
    () =>
      JSON.stringify([...hiddenDefaults].sort()) !==
      JSON.stringify([...savedHiddenDefaults].sort()),
    [hiddenDefaults, savedHiddenDefaults]
  );

  const modulesDirty = useMemo(
    () => JSON.stringify(activeModules) !== JSON.stringify(savedModules),
    [activeModules, savedModules]
  );
  const categoriesDirty = useMemo(
    () => JSON.stringify(categories) !== JSON.stringify(savedCategories),
    [categories, savedCategories]
  );
  const homeAddressDirty = useMemo(
    () => homeAddress.trim() !== savedHomeAddress.trim(),
    [homeAddress, savedHomeAddress]
  );

  const cpaEmailDirty = useMemo(
    () => cpaEmail.trim() !== savedCpaEmail.trim(),
    [cpaEmail, savedCpaEmail]
  );

  const bracketDirty = useMemo(
    () =>
      incomePct.trim() !== savedIncomePct.trim() ||
      sePct.trim() !== savedSePct.trim(),
    [incomePct, sePct, savedIncomePct, savedSePct]
  );
  const incomeCategoriesDirty = useMemo(
    () =>
      JSON.stringify([...incomeCategories].sort()) !==
      JSON.stringify([...savedIncomeCategories].sort()),
    [incomeCategories, savedIncomeCategories]
  );
  // IRS rate dirty when parsed input differs from saved value. Empty input
  // is treated as "no change" rather than 0 so accidentally clearing the
  // field doesn't enable the save button on garbage.
  const irsRateDirty = useMemo(() => {
    const trimmed = irsRateInput.trim();
    if (trimmed === "") return false;
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return false;
    return Math.abs(num - savedIrsRate) > 1e-6;
  }, [irsRateInput, savedIrsRate]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = await res.json();
        setPlan(data.plan);
        setIndustry(data.industry ?? null);
        setIndustryDefaults(Array.isArray(data.industryDefaults) ? data.industryDefaults : []);
        const initialModules = data.settings?.active_modules || ["invoices", "expenses"];
        const initialCategories = Array.isArray(data.settings?.custom_categories) ? data.settings.custom_categories : [];
        const initialHomeAddress = typeof data.homeAddress === "string" ? data.homeAddress : "";
        // Preferences round-trips as a JSON object so other fields aren't
        // clobbered when saving hidden_industry_defaults.
        const rawPrefs =
          data.settings?.preferences && typeof data.settings.preferences === "object"
            ? (data.settings.preferences as Record<string, unknown>)
            : {};
        const initialHiddenDefaults = Array.isArray(rawPrefs.hidden_industry_defaults)
          ? (rawPrefs.hidden_industry_defaults as unknown[]).filter(
              (v): v is string => typeof v === "string"
            )
          : [];
        const initialIncomeCategories = Array.isArray(rawPrefs.custom_income_categories)
          ? (rawPrefs.custom_income_categories as unknown[]).filter(
              (v): v is string => typeof v === "string"
            )
          : [];
        // Phase 7a commit 5: CPA email lives at preferences.cpa.email.
        // Tolerates either the structured object form or a missing key.
        const rawCpa = rawPrefs.cpa;
        const initialCpaEmail =
          rawCpa &&
          typeof rawCpa === "object" &&
          typeof (rawCpa as Record<string, unknown>).email === "string"
            ? ((rawCpa as Record<string, unknown>).email as string)
            : "";
        setActiveModules(initialModules);
        setCategories(initialCategories);
        setSavedModules(initialModules);
        setSavedCategories(initialCategories);
        setHomeAddress(initialHomeAddress);
        setSavedHomeAddress(initialHomeAddress);
        setPreferences(rawPrefs);
        setHiddenDefaults(initialHiddenDefaults);
        setSavedHiddenDefaults(initialHiddenDefaults);
        setIncomeCategories(initialIncomeCategories);
        setSavedIncomeCategories(initialIncomeCategories);
        // Phase 7c: read taxBracket override; fall back to defaults.
        const rawBracket =
          rawPrefs.taxBracket &&
          typeof rawPrefs.taxBracket === "object"
            ? (rawPrefs.taxBracket as Record<string, unknown>)
            : {};
        const initialIncomePct =
          typeof rawBracket.incomePct === "number"
            ? String(rawBracket.incomePct)
            : "22";
        const initialSePct =
          typeof rawBracket.sePct === "number"
            ? String(rawBracket.sePct)
            : "14.13";
        setIncomePct(initialIncomePct);
        setSePct(initialSePct);
        setSavedIncomePct(initialIncomePct);
        setSavedSePct(initialSePct);

        setCpaEmail(initialCpaEmail);
        setSavedCpaEmail(initialCpaEmail);
        // Phase 5 commit 8: IRS rate is global, so it comes back on the
        // top-level response (not nested under settings.preferences).
        if (typeof data.irsMileageRate === "number") {
          setSavedIrsRate(data.irsMileageRate);
          setIrsRateInput(data.irsMileageRate.toString());
        }
        if (data.rateSource === "config" || data.rateSource === "fallback") {
          setIrsRateSource(data.rateSource);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (
      !modulesDirty &&
      !categoriesDirty &&
      !homeAddressDirty &&
      !hiddenDefaultsDirty &&
      !incomeCategoriesDirty &&
      !irsRateDirty &&
      !cpaEmailDirty &&
      !bracketDirty
    )
      return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [
    modulesDirty,
    categoriesDirty,
    homeAddressDirty,
    hiddenDefaultsDirty,
    incomeCategoriesDirty,
    irsRateDirty,
    cpaEmailDirty,
    bracketDirty,
  ]);

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
    const toSave = activeModules;
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeModules: toSave }),
      });
      if (res.ok) {
        setSavedModules(toSave);
        setSaved(true);
      }
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

  const clearCustomCategories = () => {
    setCategories([]);
    setCatSaved(false);
  };

  const saveCategories = async () => {
    setCatSaving(true);
    const toSave = categories;
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customCategories: toSave }),
      });
      if (res.ok) {
        setSavedCategories(toSave);
        setCatSaved(true);
      }
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setCatSaving(false);
    }
  };

  // Phase 4 commit 8: hide/un-hide handlers. The pill X button calls
  // hideDefault(name); the un-hide section's button calls
  // unhideDefault(name). Both mutate the live state; the user clicks
  // "Save hidden defaults" to persist.
  const hideDefault = (name: string) => {
    setHiddenDefaults((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setHiddenDefaultsSaved(false);
  };
  const unhideDefault = (name: string) => {
    setHiddenDefaults((prev) => prev.filter((n) => n !== name));
    setHiddenDefaultsSaved(false);
  };

  // Phase 4 commit 8: save hidden defaults. Merges into the live
  // preferences object so other fields aren't clobbered (none today,
  // but the round-trip is the safe pattern).
  const saveHiddenDefaults = async () => {
    setHiddenDefaultsSaving(true);
    const toSave = [...hiddenDefaults];
    const newPreferences = { ...preferences, hidden_industry_defaults: toSave };
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: newPreferences }),
      });
      if (res.ok) {
        setPreferences(newPreferences);
        setSavedHiddenDefaults(toSave);
        setHiddenDefaultsSaved(true);
      }
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setHiddenDefaultsSaving(false);
    }
  };

  // Phase 5 commit 8: income-category handlers + save. Same pattern as
  // expense categories, but persisted under preferences.custom_income_categories
  // (the design decision from sub-session 19).
  const addIncomeCategory = () => {
    const trimmed = newIncomeCategory.trim();
    if (!trimmed) return;
    if (incomeCategories.includes(trimmed)) return;
    setIncomeCategories((prev) => [...prev, trimmed]);
    setNewIncomeCategory("");
    setIncomeCatSaved(false);
  };

  const removeIncomeCategory = (cat: string) => {
    setIncomeCategories((prev) => prev.filter((c) => c !== cat));
    setIncomeCatSaved(false);
  };

  const saveIncomeCategories = async () => {
    setIncomeCatSaving(true);
    const toSave = [...incomeCategories];
    const newPreferences = { ...preferences, custom_income_categories: toSave };
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: newPreferences }),
      });
      if (res.ok) {
        setPreferences(newPreferences);
        setSavedIncomeCategories(toSave);
        setIncomeCatSaved(true);
      }
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setIncomeCatSaving(false);
    }
  };

  // Phase 5 commit 8: save IRS mileage rate. Validates inline before the
  // round-trip so the user gets specific feedback. The API re-validates
  // (sanity ceiling 10/mi). On success, rateSource flips to "config" — a
  // configured value is now in the table.
  const saveIrsRate = async () => {
    setIrsRateError(null);
    const trimmed = irsRateInput.trim().replace(/^\$/, "");
    const rate = Number(trimmed);
    if (!Number.isFinite(rate) || rate <= 0) {
      setIrsRateError("Rate must be a positive number (dollars per mile).");
      return;
    }
    if (rate > 10) {
      setIrsRateError("Rate looks too high — did you mean dollars per mile?");
      return;
    }
    setIrsRateSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ irsMileageRate: rate }),
      });
      if (res.ok) {
        setSavedIrsRate(rate);
        setIrsRateSource("config");
        setIrsRateSaved(true);
      } else {
        const data = await res.json().catch(() => null);
        const msg =
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : `Couldn't save (HTTP ${res.status})`;
        setIrsRateError(msg);
      }
    } catch (err) {
      setIrsRateError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setIrsRateSaving(false);
    }
  };

  // Phase 4: save home address. The /api/settings PATCH path recomputes
  // mileage for every event of this client with an address — bounded
  // wait while the user sees the "Saving..." state.
  const saveHomeAddress = async () => {
    setHomeAddressSaving(true);
    setHomeAddressRecomputeMsg(null);
    const toSave = homeAddress.trim();
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeAddress: toSave === "" ? null : toSave }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as {
          recomputedEventCount?: number;
        } | null;
        setSavedHomeAddress(toSave);
        setHomeAddressSaved(true);
        if (data && typeof data.recomputedEventCount === "number" && data.recomputedEventCount > 0) {
          setHomeAddressRecomputeMsg(
            toSave === ""
              ? `Cleared mileage on ${data.recomputedEventCount} event${data.recomputedEventCount === 1 ? "" : "s"}.`
              : `Recalculated mileage for ${data.recomputedEventCount} event${data.recomputedEventCount === 1 ? "" : "s"}.`
          );
        }
      }
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setHomeAddressSaving(false);
    }
  };

  // Phase 7a commit 5: save CPA email to preferences.cpa.email.
  // Lax email validation client-side (single @, single dot at minimum)
  // — server can re-validate at send time (commit 8). Empty value
  // saves as preferences.cpa = { email: "" } which the send route
  // treats as "not set" (mirrors the customer_email handling pattern
  // in Phase 6).
  // Phase 7c commit 8: save tax bracket override. Validates both
  // values as positive finite numbers; saves the whole pair to
  // preferences.taxBracket. Empty/default save also clears the
  // override.
  const saveTaxBracket = async () => {
    setBracketSaving(true);
    setBracketError(null);
    const incomeNum = Number(incomePct);
    const seNum = Number(sePct);
    if (!Number.isFinite(incomeNum) || incomeNum < 0 || incomeNum > 50) {
      setBracketError("Income tax % must be a number between 0 and 50.");
      setBracketSaving(false);
      return;
    }
    if (!Number.isFinite(seNum) || seNum < 0 || seNum > 30) {
      setBracketError("SE tax % must be a number between 0 and 30.");
      setBracketSaving(false);
      return;
    }
    const newPreferences = {
      ...preferences,
      taxBracket: { incomePct: incomeNum, sePct: seNum },
    };
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: newPreferences }),
      });
      if (res.ok) {
        setPreferences(newPreferences);
        setSavedIncomePct(String(incomeNum));
        setSavedSePct(String(seNum));
        setBracketSaved(true);
      } else {
        setBracketError(`Couldn't save: HTTP ${res.status}`);
      }
    } catch (err) {
      setBracketError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBracketSaving(false);
    }
  };

  const saveCpaEmail = async () => {
    setCpaEmailSaving(true);
    setCpaEmailError(null);
    const toSave = cpaEmail.trim();
    if (toSave !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toSave)) {
      setCpaEmailError("That doesn't look like a valid email address.");
      setCpaEmailSaving(false);
      return;
    }
    const newPreferences = {
      ...preferences,
      cpa: { email: toSave },
    };
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: newPreferences }),
      });
      if (res.ok) {
        setPreferences(newPreferences);
        setSavedCpaEmail(toSave);
        setCpaEmailSaved(true);
      } else {
        setCpaEmailError(`Couldn't save: HTTP ${res.status}`);
      }
    } catch (err) {
      console.error("Save failed:", err);
      setCpaEmailError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setCpaEmailSaving(false);
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
              disabled={saving || !modulesDirty}
              className={`py-2.5 px-6 rounded-lg border-0 text-white text-sm font-semibold ${
                modulesDirty ? "bg-blue-500 cursor-pointer" : "bg-slate-300 cursor-not-allowed"
              } ${saving ? "opacity-50" : ""}`}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
            {modulesDirty && <span className="text-sm text-amber-600 font-medium">Unsaved changes</span>}
            {!modulesDirty && saved && <span className="text-sm text-green-600 font-medium">{"✓ Saved"}</span>}
          </div>
        </div>

        {/* Categories — expense + income. The industry defaults block
            inside this section shows both types (categories carry a
            `type` field in lib/categories.ts); the two pill subsections
            below are user-added customs, one for each direction.
            Phase 5 commit 8 added the income subsection — without it,
            a custom income category like "Wholesale Orders" was
            subtracted from revenue as an expense by /api/profitability. */}
        <div className="mb-10">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-900 mb-1">Categories</h2>
            <p className="text-sm text-slate-500 m-0">Customize how your expenses and income are organized</p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            {industryDefaults.length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-slate-500 mb-2">
                  Defaults for {industry || "your business"} — click {"✕"} to hide ones you don&apos;t use
                </p>
                <div className="flex flex-wrap gap-2">
                  {industryDefaults
                    .filter((name) => !hiddenDefaults.includes(name))
                    .map((name) => (
                      <span
                        key={`default-${name}`}
                        className="rounded-[20px] bg-slate-100 text-slate-600 text-[13px] py-1.5 px-3 inline-flex items-center gap-1.5"
                      >
                        {name}
                        <button
                          onClick={() => hideDefault(name)}
                          title={`Hide ${name}`}
                          className="bg-transparent border-0 cursor-pointer text-xs text-slate-400 p-0 leading-none"
                        >
                          {"✕"}
                        </button>
                      </span>
                    ))}
                </div>

                {/* Hidden defaults — collapsible "Show hidden (N)" section
                    so the un-hide path isn't a dead end. */}
                {hiddenDefaults.length > 0 && (
                  <div className="mt-3">
                    <button
                      onClick={() => setShowHiddenDefaults((v) => !v)}
                      className="bg-transparent border-0 text-xs text-blue-600 cursor-pointer p-0"
                      aria-expanded={showHiddenDefaults}
                    >
                      {showHiddenDefaults
                        ? `− Hide ${hiddenDefaults.length} hidden default${hiddenDefaults.length === 1 ? "" : "s"}`
                        : `+ Show ${hiddenDefaults.length} hidden default${hiddenDefaults.length === 1 ? "" : "s"}`}
                    </button>
                    {showHiddenDefaults && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {hiddenDefaults.map((name) => (
                          <span
                            key={`hidden-${name}`}
                            className="rounded-[20px] border border-dashed border-slate-300 text-slate-400 text-[13px] py-1.5 px-3 inline-flex items-center gap-1.5"
                          >
                            {name}
                            <button
                              onClick={() => unhideDefault(name)}
                              title={`Show ${name}`}
                              className="bg-transparent border-0 cursor-pointer text-xs text-blue-600 p-0 leading-none"
                            >
                              {"+"}
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Save controls — same dirty-state pattern as the other
                    three sections (modules, categories, home address). */}
                <div className="flex items-center gap-3 mt-4 flex-wrap">
                  <button
                    onClick={saveHiddenDefaults}
                    disabled={hiddenDefaultsSaving || !hiddenDefaultsDirty}
                    className={`py-2 px-4 rounded-lg border-0 text-white text-xs font-semibold ${
                      hiddenDefaultsDirty ? "bg-blue-500 cursor-pointer" : "bg-slate-300 cursor-not-allowed"
                    } ${hiddenDefaultsSaving ? "opacity-50" : ""}`}
                  >
                    {hiddenDefaultsSaving ? "Saving..." : "Save hidden defaults"}
                  </button>
                  {hiddenDefaultsDirty && (
                    <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
                  )}
                  {!hiddenDefaultsDirty && hiddenDefaultsSaved && (
                    <span className="text-xs text-green-600 font-medium">{"✓ Saved"}</span>
                  )}
                </div>
              </div>
            )}

            <p className="text-xs text-slate-700 font-semibold mb-2 mt-2">Custom expense categories</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {categories.length === 0 && (
                <span className="text-[13px] text-slate-400 italic">
                  No custom expense categories yet — add one below.
                </span>
              )}
              {categories.map((cat) => (
                <div
                  key={cat}
                  className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-[20px] py-1.5 px-3"
                >
                  <span className="text-[13px] font-medium text-red-800">{cat}</span>
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
                placeholder="Add new expense category..."
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

            <div className="flex items-center gap-3 mb-6 flex-wrap">
              <button
                onClick={saveCategories}
                disabled={catSaving || !categoriesDirty}
                className={`py-2.5 px-6 rounded-lg border-0 text-white text-sm font-semibold ${
                  categoriesDirty ? "bg-blue-500 cursor-pointer" : "bg-slate-300 cursor-not-allowed"
                } ${catSaving ? "opacity-50" : ""}`}
              >
                {catSaving ? "Saving..." : "Save expense categories"}
              </button>
              {categoriesDirty && <span className="text-sm text-amber-600 font-medium">Unsaved changes</span>}
              {!categoriesDirty && catSaved && <span className="text-sm text-green-600 font-medium">{"✓ Saved"}</span>}
              <button
                onClick={clearCustomCategories}
                className="py-2.5 px-5 rounded-lg border border-slate-200 bg-white cursor-pointer text-[13px] text-slate-500"
              >
                Clear
              </button>
            </div>

            {/* Phase 5 commit 8: custom income categories. Persisted under
                preferences.custom_income_categories. Green pills to mirror
                the visual income/expense distinction used elsewhere. */}
            <p className="text-xs text-slate-700 font-semibold mb-2 pt-4 border-t border-slate-100">
              Custom income categories
            </p>
            <p className="text-xs text-slate-500 mb-2 m-0">
              Categories that count as <strong>income</strong> in your profit & loss
              (e.g. &quot;Wholesale orders&quot;, &quot;Workshop fees&quot;).
            </p>
            <div className="flex flex-wrap gap-2 mb-4 mt-2">
              {incomeCategories.length === 0 && (
                <span className="text-[13px] text-slate-400 italic">
                  No custom income categories yet — add one below.
                </span>
              )}
              {incomeCategories.map((cat) => (
                <div
                  key={cat}
                  className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-[20px] py-1.5 px-3"
                >
                  <span className="text-[13px] font-medium text-green-800">{cat}</span>
                  <button
                    onClick={() => removeIncomeCategory(cat)}
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
                value={newIncomeCategory}
                onChange={(e) => setNewIncomeCategory(e.target.value)}
                placeholder="Add new income category..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") addIncomeCategory();
                }}
                className="flex-1 py-2.5 px-3.5 text-sm border border-slate-200 rounded-lg outline-none box-border"
              />
              <button
                onClick={addIncomeCategory}
                className="py-2.5 px-5 rounded-lg border border-slate-200 bg-white cursor-pointer text-sm font-medium text-slate-700"
              >
                Add
              </button>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={saveIncomeCategories}
                disabled={incomeCatSaving || !incomeCategoriesDirty}
                className={`py-2.5 px-6 rounded-lg border-0 text-white text-sm font-semibold ${
                  incomeCategoriesDirty ? "bg-blue-500 cursor-pointer" : "bg-slate-300 cursor-not-allowed"
                } ${incomeCatSaving ? "opacity-50" : ""}`}
              >
                {incomeCatSaving ? "Saving..." : "Save income categories"}
              </button>
              {incomeCategoriesDirty && (
                <span className="text-sm text-amber-600 font-medium">Unsaved changes</span>
              )}
              {!incomeCategoriesDirty && incomeCatSaved && (
                <span className="text-sm text-green-600 font-medium">{"✓ Saved"}</span>
              )}
            </div>
          </div>
        </div>

        {/* Phase 4: Home Address — drives event mileage calculation.
            Saving recomputes mileage for every existing event with an
            address (closes the events-before-address ordering gap). */}
        <div className="mb-10">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-900 mb-1">Your home address</h2>
            <p className="text-sm text-slate-500 m-0">
              Used to calculate driving mileage for each of your events.
              FlowWork sends this to Google Maps to look up distances — saved on your account, not shared elsewhere.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            <input
              id="settings-home-address"
              type="text"
              value={homeAddress}
              onChange={(e) => {
                setHomeAddress(e.target.value);
                setHomeAddressSaved(false);
                setHomeAddressRecomputeMsg(null);
              }}
              placeholder="123 Main St, Indianapolis, IN 46201"
              className="w-full py-2.5 px-3.5 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 mb-4"
            />

            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={saveHomeAddress}
                disabled={homeAddressSaving || !homeAddressDirty}
                className={`py-2.5 px-6 rounded-lg border-0 text-white text-sm font-semibold ${
                  homeAddressDirty ? "bg-blue-500 cursor-pointer" : "bg-slate-300 cursor-not-allowed"
                } ${homeAddressSaving ? "opacity-50" : ""}`}
              >
                {homeAddressSaving ? "Saving..." : "Save home address"}
              </button>
              {homeAddressDirty && (
                <span className="text-sm text-amber-600 font-medium">Unsaved changes</span>
              )}
              {!homeAddressDirty && homeAddressSaved && (
                <span className="text-sm text-green-600 font-medium">{"✓ Saved"}</span>
              )}
            </div>
            {homeAddressRecomputeMsg && (
              <p className="text-xs text-slate-500 mt-3 m-0">
                {"\u{1F697}"} {homeAddressRecomputeMsg}
              </p>
            )}
          </div>
        </div>

        {/* Phase 5 commit 8: IRS mileage rate edit. The rate is federal
            (one value across the entire app, in app_settings) — editing it
            changes mileage math for every tenant. The visible indicator
            tells the user when the stored value is the hardcoded fallback
            vs. a configured row. */}
        <div className="mb-10">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-900 mb-1">IRS mileage rate</h2>
            <p className="text-sm text-slate-500 m-0">
              The standard mileage rate ({"$"}per mile) the IRS publishes each
              year for business driving. Used to compute the mileage-cost line on
              each event&apos;s profit & loss.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            {irsRateSource === "fallback" && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 mb-4 text-sm">
                <strong>Using default rate</strong> (${savedIrsRate.toFixed(2)}/mi).
                No configured value found — save below to make this the configured
                rate.
              </div>
            )}
            {irsRateSource === "config" && (
              <p className="text-xs text-slate-500 m-0 mb-3">
                Currently configured: <strong>${savedIrsRate.toFixed(2)}/mi</strong>
              </p>
            )}

            {irsRateError && (
              <div className="bg-red-50 border border-red-200 text-red-800 px-3.5 py-2.5 rounded-lg mb-3 text-sm">
                {irsRateError}
              </div>
            )}

            <label htmlFor="settings-irs-rate" className="block text-sm font-medium text-slate-700 mb-1">
              Rate (dollars per mile)
            </label>
            <div className="flex gap-2 mb-2">
              <input
                id="settings-irs-rate"
                type="text"
                inputMode="decimal"
                value={irsRateInput}
                onChange={(e) => {
                  setIrsRateInput(e.target.value);
                  setIrsRateSaved(false);
                  setIrsRateError(null);
                }}
                placeholder="0.70"
                className="w-32 py-2.5 px-3.5 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <button
                onClick={saveIrsRate}
                disabled={irsRateSaving || !irsRateDirty}
                className={`py-2.5 px-6 rounded-lg border-0 text-white text-sm font-semibold ${
                  irsRateDirty ? "bg-blue-500 cursor-pointer" : "bg-slate-300 cursor-not-allowed"
                } ${irsRateSaving ? "opacity-50" : ""}`}
              >
                {irsRateSaving ? "Saving..." : "Save rate"}
              </button>
              {irsRateDirty && (
                <span className="text-sm text-amber-600 font-medium self-center">Unsaved changes</span>
              )}
              {!irsRateDirty && irsRateSaved && (
                <span className="text-sm text-green-600 font-medium self-center">{"✓ Saved"}</span>
              )}
            </div>
            <p className="text-xs text-slate-500 m-0">
              The IRS publishes one figure per year. Changing this updates the rate
              everywhere FlowWork computes mileage costs.
            </p>
          </div>
        </div>

        {/* Phase 7a commit 5: CPA Handoff. Stores preferences.cpa.email.
            Used by POST /api/reports/annual/send (commit 8) as the
            destination when the user clicks "Send to CPA" on /reports.
            Mirror of the home-address section pattern (single field,
            dirty-state save, ✓/Unsaved indicators). */}
        <div className="mb-10">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-900 mb-1">CPA Handoff</h2>
            <p className="text-sm text-slate-500 m-0">
              The email FlowWork sends your annual summary to when you click
              {" "}<strong>Send to CPA</strong> on the Tax Reports page. Your
              own email goes on Reply-To so your CPA can reply directly to you.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            {cpaEmailError && (
              <div className="bg-red-50 border border-red-200 text-red-800 px-3.5 py-2.5 rounded-lg mb-3 text-sm">
                {cpaEmailError}
              </div>
            )}

            <label htmlFor="settings-cpa-email" className="block text-sm font-medium text-slate-700 mb-1">
              CPA email
            </label>
            <input
              id="settings-cpa-email"
              type="email"
              value={cpaEmail}
              onChange={(e) => {
                setCpaEmail(e.target.value);
                setCpaEmailSaved(false);
                setCpaEmailError(null);
              }}
              placeholder="alex@cpa-firm.com"
              className="w-full py-2.5 px-3.5 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 mb-4"
            />

            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={saveCpaEmail}
                disabled={cpaEmailSaving || !cpaEmailDirty}
                className={`py-2.5 px-6 rounded-lg border-0 text-white text-sm font-semibold ${
                  cpaEmailDirty ? "bg-blue-500 cursor-pointer" : "bg-slate-300 cursor-not-allowed"
                } ${cpaEmailSaving ? "opacity-50" : ""}`}
              >
                {cpaEmailSaving ? "Saving..." : "Save CPA email"}
              </button>
              {cpaEmailDirty && (
                <span className="text-sm text-amber-600 font-medium">Unsaved changes</span>
              )}
              {!cpaEmailDirty && cpaEmailSaved && (
                <span className="text-sm text-green-600 font-medium">{"✓ Saved"}</span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-3 m-0">
              Optional. Leave blank to disable the {"“"}Send to CPA{"”"} button
              on the Tax Reports page.
            </p>
          </div>
        </div>

        {/* Phase 7c commit 8: Tax bracket assumption. Drives the
            quarterly-estimate math in /reports (lib/quarterly.ts).
            Two inputs because the calc is incomePct + sePct; we save
            them as one pair under preferences.taxBracket. Defaults
            shown match DEFAULT_TAX_BRACKET (22 income + 14.13 SE =
            36.13 effective). The "verify with your CPA" disclaimer
            is mandatory per design §1 #6 — the math is a planning
            aid, not tax advice. */}
        <div className="mb-10">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-900 mb-1">Tax bracket assumption</h2>
            <p className="text-sm text-slate-500 m-0">
              Used by Tax Reports to suggest quarterly estimated payments. The
              defaults below cover a typical single-filer in the 22% federal
              bracket — adjust to match your situation, or leave alone if you
              aren&apos;t sure.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            {bracketError && (
              <div className="bg-red-50 border border-red-200 text-red-800 px-3.5 py-2.5 rounded-lg mb-3 text-sm">
                {bracketError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label htmlFor="settings-income-pct" className="block text-sm font-medium text-slate-700 mb-1">
                  Income tax %
                </label>
                <input
                  id="settings-income-pct"
                  type="text"
                  inputMode="decimal"
                  value={incomePct}
                  onChange={(e) => {
                    setIncomePct(e.target.value);
                    setBracketSaved(false);
                    setBracketError(null);
                  }}
                  placeholder="22"
                  className="w-full py-2.5 px-3.5 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <p className="text-xs text-slate-500 mt-1 m-0">
                  Your marginal federal bracket (default 22%).
                </p>
              </div>

              <div>
                <label htmlFor="settings-se-pct" className="block text-sm font-medium text-slate-700 mb-1">
                  Self-employment tax %
                </label>
                <input
                  id="settings-se-pct"
                  type="text"
                  inputMode="decimal"
                  value={sePct}
                  onChange={(e) => {
                    setSePct(e.target.value);
                    setBracketSaved(false);
                    setBracketError(null);
                  }}
                  placeholder="14.13"
                  className="w-full py-2.5 px-3.5 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <p className="text-xs text-slate-500 mt-1 m-0">
                  Effective SE tax (default 14.13%).
                </p>
              </div>
            </div>

            <p className="text-sm text-slate-600 mb-4 m-0">
              Effective set-aside: <strong>
                {(() => {
                  const i = Number(incomePct);
                  const s = Number(sePct);
                  if (!Number.isFinite(i) || !Number.isFinite(s)) return "—";
                  return `${(i + s).toFixed(2)}%`;
                })()}
              </strong>
            </p>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={saveTaxBracket}
                disabled={bracketSaving || !bracketDirty}
                className={`py-2.5 px-6 rounded-lg border-0 text-white text-sm font-semibold ${
                  bracketDirty ? "bg-blue-500 cursor-pointer" : "bg-slate-300 cursor-not-allowed"
                } ${bracketSaving ? "opacity-50" : ""}`}
              >
                {bracketSaving ? "Saving..." : "Save tax bracket"}
              </button>
              {bracketDirty && (
                <span className="text-sm text-amber-600 font-medium">Unsaved changes</span>
              )}
              {!bracketDirty && bracketSaved && (
                <span className="text-sm text-green-600 font-medium">{"✓ Saved"}</span>
              )}
            </div>

            <p className="text-xs text-slate-500 mt-3 m-0">
              <strong>Not tax advice.</strong> Quarterly estimates are a
              rough planning aid based on linear projection of YTD profit.
              Verify with your CPA before making payments.
            </p>
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
