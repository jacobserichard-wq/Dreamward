"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import PageHeader from "../components/PageHeader";
import AppHeader from "../components/AppHeader";
import RestoreTipsButton from "../components/RestoreTipsButton";

export default function SettingsPage() {
  const [industry, setIndustry] = useState<string | null>(null);
  const [industryDefaults, setIndustryDefaults] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [catSaving, setCatSaving] = useState(false);
  const [catSaved, setCatSaved] = useState(false);
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

  // Labor rate (clients.labor_hourly_rate) — drives the product "margin
  // after labor" pricing lens only. Never used for taxes.
  const [laborRate, setLaborRate] = useState("");
  const [savedLaborRate, setSavedLaborRate] = useState("");
  const [laborRateSaving, setLaborRateSaving] = useState(false);
  const [laborRateSaved, setLaborRateSaved] = useState(false);
  const [laborRateError, setLaborRateError] = useState<string | null>(null);

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

  // IRS mileage rate is a global (federal) value in app_settings —
  // read-only here, set system-wide (not per customer). Kept for display
  // on the tax surfaces so the user can see the rate their deduction uses.
  const [savedIrsRate, setSavedIrsRate] = useState<number>(0.7);

  // Vehicle config (gas price + MPG) drives the operating-rate
  // mileage cost on profitability surfaces. Defaults match
  // lib/mileageRates.ts constants — $3.67/gal + 30 mpg = $0.12/mi.
  // Persisted under preferences.vehicle.{gas_price_per_gallon, mpg}.
  const [gasPriceInput, setGasPriceInput] = useState<string>("3.67");
  const [mpgInput, setMpgInput] = useState<string>("30");
  const [savedGasPrice, setSavedGasPrice] = useState<string>("3.67");
  const [savedMpg, setSavedMpg] = useState<string>("30");
  const [vehicleSourceConfig, setVehicleSourceConfig] = useState(false);
  const [vehicleSaving, setVehicleSaving] = useState(false);
  const [vehicleSaved, setVehicleSaved] = useState(false);
  const [vehicleError, setVehicleError] = useState<string | null>(null);

  // Daily sales-summary email opt-out. Stored as
  // preferences.daily_cogs_digest_disabled (true = opted out; default on).
  const [digestDisabled, setDigestDisabled] = useState(false);
  const [digestSaving, setDigestSaving] = useState(false);
  const [digestSaved, setDigestSaved] = useState(false);

  const hiddenDefaultsDirty = useMemo(
    () =>
      JSON.stringify([...hiddenDefaults].sort()) !==
      JSON.stringify([...savedHiddenDefaults].sort()),
    [hiddenDefaults, savedHiddenDefaults]
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

  const laborRateDirty = useMemo(
    () => laborRate.trim() !== savedLaborRate.trim(),
    [laborRate, savedLaborRate]
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
  const vehicleDirty = useMemo(
    () =>
      gasPriceInput.trim() !== savedGasPrice.trim() ||
      mpgInput.trim() !== savedMpg.trim(),
    [gasPriceInput, mpgInput, savedGasPrice, savedMpg]
  );

  // Live preview of operating rate computed from current inputs
  // (defensive: falls back to dashes when inputs are non-numeric).
  const operatingRatePreview = useMemo(() => {
    const gas = Number(gasPriceInput);
    const mpg = Number(mpgInput);
    if (!Number.isFinite(gas) || !Number.isFinite(mpg) || gas <= 0 || mpg <= 0) {
      return "—";
    }
    return `$${(gas / mpg).toFixed(2)}/mi`;
  }, [gasPriceInput, mpgInput]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = await res.json();
        setIndustry(data.industry ?? null);
        setIndustryDefaults(Array.isArray(data.industryDefaults) ? data.industryDefaults : []);
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
        setCategories(initialCategories);
        setSavedCategories(initialCategories);
        setHomeAddress(initialHomeAddress);
        setSavedHomeAddress(initialHomeAddress);
        setPreferences(rawPrefs);
        setDigestDisabled(rawPrefs.daily_cogs_digest_disabled === true);
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

        const initialLaborRate =
          typeof data.laborHourlyRate === "number"
            ? String(data.laborHourlyRate)
            : "";
        setLaborRate(initialLaborRate);
        setSavedLaborRate(initialLaborRate);
        // IRS rate is global, returned at the top level. Read-only display.
        if (typeof data.irsMileageRate === "number") {
          setSavedIrsRate(data.irsMileageRate);
        }

        // Vehicle config (gas + MPG). Lives under preferences.vehicle.
        // Falls back to display defaults when not set; sourceConfig
        // flag tells the UI whether both values are user-configured.
        const rawVehicle =
          rawPrefs.vehicle &&
          typeof rawPrefs.vehicle === "object" &&
          rawPrefs.vehicle !== null
            ? (rawPrefs.vehicle as Record<string, unknown>)
            : {};
        const rawGas =
          typeof rawVehicle.gas_price_per_gallon === "number"
            ? rawVehicle.gas_price_per_gallon
            : null;
        const rawMpg =
          typeof rawVehicle.mpg === "number" ? rawVehicle.mpg : null;
        const initialGasPrice =
          rawGas !== null && rawGas > 0 ? String(rawGas) : "3.67";
        const initialMpg =
          rawMpg !== null && rawMpg > 0 ? String(rawMpg) : "30";
        setGasPriceInput(initialGasPrice);
        setMpgInput(initialMpg);
        setSavedGasPrice(initialGasPrice);
        setSavedMpg(initialMpg);
        setVehicleSourceConfig(rawGas !== null && rawMpg !== null);
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
      !categoriesDirty &&
      !homeAddressDirty &&
      !hiddenDefaultsDirty &&
      !incomeCategoriesDirty &&
      !cpaEmailDirty &&
      !laborRateDirty &&
      !bracketDirty &&
      !vehicleDirty
    )
      return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [
    categoriesDirty,
    homeAddressDirty,
    hiddenDefaultsDirty,
    incomeCategoriesDirty,
    cpaEmailDirty,
    laborRateDirty,
    bracketDirty,
    vehicleDirty,
  ]);

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

  // Save vehicle preferences (gas price + MPG). Validates both
  // values inline before round-trip; persists under
  // preferences.vehicle = { gas_price_per_gallon, mpg }. Once saved
  // the operating-rate flips from "default" to "config" on the
  // server side, which surfaces in /profitability + dashboard rate
  // labeling.
  const saveVehicle = async () => {
    setVehicleSaving(true);
    setVehicleError(null);
    const gasNum = Number(gasPriceInput);
    const mpgNum = Number(mpgInput);
    if (!Number.isFinite(gasNum) || gasNum < 0.5 || gasNum > 20) {
      setVehicleError(
        "Gas price must be a positive number between $0.50 and $20 per gallon."
      );
      setVehicleSaving(false);
      return;
    }
    if (!Number.isFinite(mpgNum) || mpgNum < 5 || mpgNum > 200) {
      setVehicleError("MPG must be a number between 5 and 200.");
      setVehicleSaving(false);
      return;
    }
    const newPreferences = {
      ...preferences,
      vehicle: { gas_price_per_gallon: gasNum, mpg: mpgNum },
    };
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: newPreferences }),
      });
      if (res.ok) {
        setPreferences(newPreferences);
        setSavedGasPrice(String(gasNum));
        setSavedMpg(String(mpgNum));
        setVehicleSourceConfig(true);
        setVehicleSaved(true);
      } else {
        setVehicleError(`Couldn't save: HTTP ${res.status}`);
      }
    } catch (err) {
      setVehicleError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setVehicleSaving(false);
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

  const saveLaborRate = async () => {
    setLaborRateSaving(true);
    setLaborRateError(null);
    const trimmed = laborRate.trim();
    let payload: number | null = null;
    if (trimmed !== "") {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) {
        setLaborRateError("Enter a non-negative number, or leave blank.");
        setLaborRateSaving(false);
        return;
      }
      payload = n;
    }
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ laborHourlyRate: payload }),
      });
      if (res.ok) {
        setSavedLaborRate(trimmed);
        setLaborRateSaved(true);
      } else {
        setLaborRateError(`Couldn't save: HTTP ${res.status}`);
      }
    } catch (err) {
      console.error("Save failed:", err);
      setLaborRateError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLaborRateSaving(false);
    }
  };

  // Toggle the daily sales-summary email. Round-trips the full preferences
  // object (PATCH replaces it wholesale) and saves immediately on toggle.
  const toggleDigest = async (enabled: boolean) => {
    const disabled = !enabled;
    const newPreferences = {
      ...preferences,
      daily_cogs_digest_disabled: disabled,
    };
    setDigestDisabled(disabled);
    setPreferences(newPreferences);
    setDigestSaving(true);
    setDigestSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: newPreferences }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDigestSaved(true);
      setTimeout(() => setDigestSaved(false), 2000);
    } catch (err) {
      console.error("Save failed:", err);
      setDigestDisabled(!disabled); // revert
    } finally {
      setDigestSaving(false);
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
      <AppHeader />
      <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          title="Settings"
          subtitle="Manage your preferences"
        />

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
              Dreamward sends this to Google Maps to look up distances — saved on your account, not shared elsewhere.
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

        {/* IRS mileage rate — read-only. The rate is federal (one value
            across the whole app, in app_settings); it's the same for
            everyone, so it's set system-wide by Dreamward, not edited per
            customer. Shown here so the user can see the rate their
            Schedule C deduction uses. */}
        <div className="mb-10">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-900 mb-1">IRS mileage rate</h2>
            <p className="text-sm text-slate-500 m-0">
              The standard rate the IRS publishes each year for business
              driving. <strong>Used for tax surfaces only</strong>:
              Schedule C mileage deduction on the Annual Report + quarterly
              tax estimates. For day-to-day profitability views, Dreamward
              uses the Operating rate below (gas ÷ MPG — the actual
              cash cost of driving).
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            <p className="text-sm text-slate-600 m-0">
              Current rate: <strong>${savedIrsRate.toFixed(2)}/mi</strong>
            </p>
            <p className="text-xs text-slate-500 mt-2 m-0">
              Set by Dreamward and updated when the IRS publishes a new
              figure each year. It applies the same to everyone, so there&apos;s
              nothing to configure here.
            </p>
          </div>
        </div>

        {/* Vehicle (operating rate) — drives the gas-cost-per-mile
            calculation used on /profitability and dashboard Channels.
            Honest cash impact of driving. Distinct from the IRS rate
            above (which is tax-deduction territory). */}
        <div className="mb-10">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-900 mb-1">
              Your vehicle
            </h2>
            <p className="text-sm text-slate-500 m-0">
              We compute the cash cost of each mile you drive as{" "}
              <strong>gas price ÷ MPG</strong>. Used on the dashboard +{" "}
              <Link href="/profitability" className="underline">
                /profitability
              </Link>{" "}
              to show real out-of-pocket driving costs. Defaults to a
              typical sedan ($3.67/gal × 30 mpg = $0.12/mi).
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            {!vehicleSourceConfig && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 mb-4 text-sm">
                <strong>Using default values</strong> — set yours below
                so profitability calculations reflect what your car
                actually costs to drive.
              </div>
            )}

            {vehicleError && (
              <div className="bg-red-50 border border-red-200 text-red-800 px-3.5 py-2.5 rounded-lg mb-3 text-sm">
                {vehicleError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label
                  htmlFor="settings-gas-price"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Gas price ($/gallon)
                </label>
                <input
                  id="settings-gas-price"
                  type="text"
                  inputMode="decimal"
                  value={gasPriceInput}
                  onChange={(e) => {
                    setGasPriceInput(e.target.value);
                    setVehicleSaved(false);
                    setVehicleError(null);
                  }}
                  placeholder="3.67"
                  className="w-full py-2.5 px-3.5 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <p className="text-xs text-slate-500 mt-1 m-0">
                  Local average where you usually fill up. Update every
                  few months if prices shift.
                </p>
              </div>

              <div>
                <label
                  htmlFor="settings-mpg"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Vehicle MPG
                </label>
                <input
                  id="settings-mpg"
                  type="text"
                  inputMode="decimal"
                  value={mpgInput}
                  onChange={(e) => {
                    setMpgInput(e.target.value);
                    setVehicleSaved(false);
                    setVehicleError(null);
                  }}
                  placeholder="30"
                  className="w-full py-2.5 px-3.5 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <p className="text-xs text-slate-500 mt-1 m-0">
                  Sedan ≈ 30, truck/van ≈ 18-22, hybrid/EV ≈ 40+
                </p>
              </div>
            </div>

            <p className="text-sm text-slate-600 mb-4 m-0">
              Operating rate: <strong>{operatingRatePreview}</strong>
            </p>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={saveVehicle}
                disabled={vehicleSaving || !vehicleDirty}
                className={`py-2.5 px-6 rounded-lg border-0 text-white text-sm font-semibold ${
                  vehicleDirty
                    ? "bg-blue-500 cursor-pointer"
                    : "bg-slate-300 cursor-not-allowed"
                } ${vehicleSaving ? "opacity-50" : ""}`}
              >
                {vehicleSaving ? "Saving..." : "Save vehicle"}
              </button>
              {vehicleDirty && (
                <span className="text-sm text-amber-600 font-medium">
                  Unsaved changes
                </span>
              )}
              {!vehicleDirty && vehicleSaved && (
                <span className="text-sm text-green-600 font-medium">
                  {"✓ Saved"}
                </span>
              )}
            </div>

            <p className="text-xs text-slate-500 mt-3 m-0">
              <strong>Note:</strong> Operating rate is just gas — it
              doesn&apos;t cover maintenance, insurance, or depreciation.
              For your Schedule C deduction, Dreamward uses the IRS
              standard rate above ($0.70/mi covers all those things).
              Both are correct for their purpose.
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
              The email Dreamward sends your annual summary to when you click
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

        {/* Email notifications — opt out of the daily sales-summary email.
            On by default; only sends on days with a mapped sale. */}
        <div className="mb-10">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-900 mb-1">
              Email notifications
            </h2>
            <p className="text-sm text-slate-500 m-0">
              Control the automatic emails Dreamward sends you.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={!digestDisabled}
                onChange={(e) => toggleDigest(e.target.checked)}
                disabled={digestSaving}
                className="mt-0.5 w-4 h-4 cursor-pointer accent-blue-500 disabled:cursor-wait"
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">
                  Daily sales summary
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  A short morning email recapping yesterday{"’"}s sales, cost of
                  goods, and margin — sent only on days you made a sale.
                </span>
              </span>
            </label>
            {digestSaved && (
              <span className="text-sm text-green-600 font-medium mt-3 inline-block">
                {"✓ Saved"}
              </span>
            )}
          </div>
        </div>

        {/* Labor rate — drives the per-product "margin after labor" pricing
            lens (skus carry minutes/unit; this is the rate they multiply by).
            Pricing aid ONLY — never enters COGS, Net Profit, or the tax
            pack, since a sole prop's own labor isn't deductible. */}
        <div className="mb-10">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-900 mb-1">
              Your labor rate
            </h2>
            <p className="text-sm text-slate-500 m-0">
              What your time is worth per hour. Combined with the
              minutes-per-unit you set on each product, it powers the{" "}
              <strong>{"“margin after labor”"}</strong> view on your SKUs — so
              you can tell whether a product actually pays for your time.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            {laborRateError && (
              <div className="bg-red-50 border border-red-200 text-red-800 px-3.5 py-2.5 rounded-lg mb-3 text-sm">
                {laborRateError}
              </div>
            )}

            <label
              htmlFor="settings-labor-rate"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Hourly rate
            </label>
            <div className="relative max-w-[220px] mb-4">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                $
              </span>
              <input
                id="settings-labor-rate"
                type="text"
                inputMode="decimal"
                value={laborRate}
                onChange={(e) => {
                  setLaborRate(e.target.value);
                  setLaborRateSaved(false);
                  setLaborRateError(null);
                }}
                placeholder="e.g. 25"
                className="w-full py-2.5 pl-7 pr-14 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                / hr
              </span>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={saveLaborRate}
                disabled={laborRateSaving || !laborRateDirty}
                className={`py-2.5 px-6 rounded-lg border-0 text-white text-sm font-semibold ${
                  laborRateDirty
                    ? "bg-blue-500 cursor-pointer"
                    : "bg-slate-300 cursor-not-allowed"
                } ${laborRateSaving ? "opacity-50" : ""}`}
              >
                {laborRateSaving ? "Saving..." : "Save labor rate"}
              </button>
              {laborRateDirty && (
                <span className="text-sm text-amber-600 font-medium">
                  Unsaved changes
                </span>
              )}
              {!laborRateDirty && laborRateSaved && (
                <span className="text-sm text-green-600 font-medium">
                  {"✓ Saved"}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-3 m-0">
              Pricing aid only — this never affects your taxes, Net Profit, or
              cost of goods sold. Leave blank to hide labor from product
              margins.
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
                  Self-employment set-aside %
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
                  Rough flat planning estimate (default 14.13%) — a set-aside,
                  not exact Schedule SE tax. Verify with your CPA.
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

        {/* Help tips — restore the SectionTip callouts dismissed via
            localStorage. Dismissals are device-local + permanent
            otherwise, so this is the only way to bring them back. */}
        <div className="mb-10">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-900 mb-1">Help tips</h2>
            <p className="text-sm text-slate-500 m-0">
              The blue {"\u{1F4A1}"} how-to callouts at the top of each page can
              be dismissed once you know your way around. Changed your mind?
              Bring them all back here.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            <RestoreTipsButton />
            <p className="text-xs text-slate-500 mt-3 m-0">
              Tips are remembered per device, so this restores them on this
              browser.
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
