// app/components/ExpenseForm.tsx
//
// Phase 9.3 commit 5 of ~8. Modal form for creating a new expense
// with channel + conditional event picker.
//
// Form flow:
//   1. Vendor (text input)
//   2. Amount ($ input)
//   3. Date (date input, defaults to today)
//   4. Category (dropdown, filtered to expense categories for industry)
//   5. Channel (dropdown, CANONICAL_CHANNELS list)
//   6. IF channel='markets' → Event picker appears (dropdown of user's events)
//   7. Notes (optional textarea)
//
// Pure-presentational. Parent supplies:
//   - The category list (already filtered by industry + custom)
//   - The events list (already loaded for the upload event-selector)
//   - onSave callback (handles the POST + UI refresh)
//   - onClose to dismiss the modal
//
// Validates inline before calling onSave; server-side re-validates.

"use client";

import { useEffect, useState } from "react";
import Spinner from "./Spinner";
import {
  CANONICAL_CHANNELS,
  type ChannelMeta,
} from "@/lib/profitability/channels";

export interface ExpenseFormCategory {
  name: string;
  description?: string;
}

export interface ExpenseFormEvent {
  id: number;
  name: string;
  startDate: string;
}

export interface ExpenseFormSubmit {
  vendor: string;
  amount: number;
  dueDate: string;
  category: string;
  channel: string | null;
  eventId: number | null;
  notes: string | null;
  /** Phase 9.4: staged receipt files to upload after the expense
   *  saves. Parent's onSave handler uploads each in parallel to
   *  /api/expenses/{id}/attachments using the freshly-saved
   *  expense's id (or editing.id in edit mode). Empty array when
   *  the merchant didn't attach anything. */
  files: File[];
}

export interface ExpenseFormProps {
  open: boolean;
  /** Expense categories for the current user's industry (already
   *  pre-filtered server-side or by parent). */
  categories: ExpenseFormCategory[];
  /** User's events list (already loaded by parent — same source as
   *  the existing upload event-selector). */
  events: ExpenseFormEvent[];
  /** Pre-selected channel — useful when launching the form from
   *  inside a channel-filtered view ("Add expense to Markets"). */
  defaultChannel?: string | null;
  /** Pre-selected event — useful when launching from an event detail
   *  page. Implies channel='markets'. */
  defaultEventId?: number | null;
  /** Phase 9.3.1: when provided, form runs in EDIT mode — pre-fills
   *  every field from this expense and submits via PATCH instead of
   *  POST. The parent's onSave handler is responsible for picking
   *  the right HTTP method based on whether editing was set. */
  editing?: {
    id: number;
    vendor: string | null;
    amount: number;
    dueDate: string | null;
    category: string | null;
    channel: string | null;
    eventId: number | null;
    notes: string | null;
  } | null;
  onSave: (data: ExpenseFormSubmit) => Promise<void>;
  onClose: () => void;
  /** Phase 9.3.2: in-line "create a new category" path. When
   *  provided, the category dropdown gets a "+ Create new
   *  category..." option that swaps to an inline input on click.
   *  Callback should PATCH /api/settings to add the new name to
   *  client_settings.custom_categories + refresh the parent's
   *  categories list. Resolves to the name string so the form can
   *  auto-select it once the parent re-renders with the new prop.
   *  If omitted, the create-new option doesn't render (back-compat). */
  onCreateCategory?: (name: string) => Promise<void>;
}

/** Filter the canonical channel list down to the ones a user
 *  would meaningfully tag an expense to. Excludes coming-soon
 *  channels (Etsy / Square / WooCommerce — no expense surface yet)
 *  and includes the "Overhead" pseudo-channel as null. */
const EXPENSE_CHANNELS: readonly ChannelMeta[] = CANONICAL_CHANNELS.filter(
  (c) => !c.comingSoon
);

function todayIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function ExpenseForm({
  open,
  categories,
  events,
  defaultChannel = null,
  defaultEventId = null,
  editing = null,
  onSave,
  onClose,
  onCreateCategory,
}: ExpenseFormProps) {
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(todayIso());
  const [category, setCategory] = useState("");
  const [channel, setChannel] = useState<string>(defaultChannel ?? "");
  const [eventId, setEventId] = useState<string>(
    defaultEventId !== null ? String(defaultEventId) : ""
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 9.4: staged receipt files. Validated client-side as
  // they're added (size + mime); parent uploads them after the
  // expense save succeeds.
  const [files, setFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  // Phase 9.3.2: in-line "create new category" state. creatingCategory
  // toggles to the input mode; newCategoryName holds the typed name;
  // creatingBusy disables the Save button while the PATCH is in flight.
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingBusy, setCreatingBusy] = useState(false);

  // Reset state when modal re-opens. Two paths:
  // - editing=null → fresh "Add expense" form (empty fields,
  //   today's date, optional pre-selected channel/event)
  // - editing!=null → pre-fill every field from the existing row
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setVendor(editing.vendor ?? "");
      setAmount(String(editing.amount));
      setDueDate(editing.dueDate ?? todayIso());
      setCategory(editing.category ?? "");
      setChannel(editing.channel ?? "");
      setEventId(editing.eventId !== null ? String(editing.eventId) : "");
      setNotes(editing.notes ?? "");
    } else {
      setVendor("");
      setAmount("");
      setDueDate(todayIso());
      setCategory("");
      setChannel(defaultChannel ?? "");
      setEventId(defaultEventId !== null ? String(defaultEventId) : "");
      setNotes("");
    }
    setError(null);
    setCreatingCategory(false);
    setNewCategoryName("");
    setFiles([]);
    setIsDragOver(false);
  }, [open, editing, defaultChannel, defaultEventId]);

  // Phase 9.3.2: handle the "+ Create new category..." submit.
  // Parent's onCreateCategory persists via PATCH /api/settings,
  // then refreshes the categories prop. Once the new name appears
  // in the categories list (next re-render), we auto-select it.
  const handleCreateCategory = async () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) {
      setError("Category name can't be empty.");
      return;
    }
    if (categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      setError("That category already exists.");
      return;
    }
    if (!onCreateCategory) return;
    setCreatingBusy(true);
    setError(null);
    try {
      await onCreateCategory(trimmed);
      // Parent re-renders with the new name in `categories`; select it.
      setCategory(trimmed);
      setCreatingCategory(false);
      setNewCategoryName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save category");
    } finally {
      setCreatingBusy(false);
    }
  };

  // Esc to close (when not saving)
  useEffect(() => {
    if (!open || saving) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, saving, onClose]);

  if (!open) return null;

  // Conditional event picker: only shown when user picks Markets
  // channel. Auto-clears the eventId state when channel changes
  // away from markets (avoids stale event_id sticking to a non-
  // markets expense).
  const showEventPicker = channel === "markets";

  // ── File-handling helpers (Phase 9.4) ────────────────────────
  const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
  const ALLOWED_MIME_TYPES = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/heic",
    "image/heif",
    "image/webp",
    "application/pdf",
  ]);

  const formatBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  };

  /** Add files to the staged list, validating each. Rejected
   *  files surface in the inline error rather than silently
   *  disappearing. Duplicates (same name + size) are skipped. */
  const addFiles = (incoming: File[]) => {
    setError(null);
    const rejected: string[] = [];
    setFiles((prev) => {
      const next = [...prev];
      for (const f of incoming) {
        const mime = (f.type || "").toLowerCase();
        if (!ALLOWED_MIME_TYPES.has(mime)) {
          rejected.push(`${f.name}: unsupported type (${mime || "unknown"})`);
          continue;
        }
        if (f.size === 0) {
          rejected.push(`${f.name}: empty file`);
          continue;
        }
        if (f.size > MAX_FILE_SIZE_BYTES) {
          rejected.push(
            `${f.name}: too large (${formatBytes(f.size)}, limit 10 MB)`
          );
          continue;
        }
        // Skip exact duplicates already in the staged list
        if (next.some((existing) => existing.name === f.name && existing.size === f.size)) {
          continue;
        }
        next.push(f);
      }
      return next;
    });
    if (rejected.length > 0) {
      setError(rejected.join("; "));
    }
  };

  const removeFileAt = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleFileInputChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    addFiles(Array.from(list));
    // Clear the input so re-picking the same file works
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragOver) setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files;
    if (!dropped || dropped.length === 0) return;
    addFiles(Array.from(dropped));
  };

  const handleSave = async () => {
    setError(null);
    const trimmedVendor = vendor.trim();
    if (!trimmedVendor) {
      setError("Vendor is required.");
      return;
    }
    const cleaned = amount.replace(/[$,\s]/g, "");
    const amt = Number(cleaned);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Amount must be a positive number.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      setError("Date must be valid.");
      return;
    }
    if (!category) {
      setError("Pick a category.");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        vendor: trimmedVendor,
        amount: amt,
        dueDate,
        category,
        channel: channel || null,
        eventId: showEventPicker && eventId ? Number(eventId) : null,
        notes: notes.trim() || null,
        files,
      });
      // Parent handles closing on success
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-form-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2
          id="expense-form-title"
          className="text-lg font-bold text-slate-900 m-0 mb-1"
        >
          {editing ? "Edit expense" : "Add an expense"}
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-5">
          {editing
            ? "Change any field below + save. Channel tag drives which profit breakdown this rolls into."
            : "Tag it to a channel so it shows up in the right profit breakdown."}
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {/* Vendor + Amount on one row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Vendor" htmlFor="expense-vendor">
              <input
                id="expense-vendor"
                type="text"
                value={vendor}
                onChange={(e) => {
                  setVendor(e.target.value);
                  setError(null);
                }}
                placeholder="e.g., Shopify, Office Depot"
                disabled={saving}
                className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
              />
            </Field>

            <Field label="Amount" htmlFor="expense-amount">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  {"$"}
                </span>
                <input
                  id="expense-amount"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setError(null);
                  }}
                  placeholder="0.00"
                  disabled={saving}
                  className="w-full py-2 pl-7 pr-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
                />
              </div>
            </Field>
          </div>

          {/* Date */}
          <Field label="Date" htmlFor="expense-date">
            <input
              id="expense-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={saving}
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
            />
          </Field>

          {/* Category — Phase 9.3.2: dropdown gains a "+ Create new
              category..." option when onCreateCategory is wired. Picking
              it swaps the dropdown for an inline input + Save / Cancel
              buttons. New category persists to client_settings.custom_
              categories via PATCH /api/settings + auto-selects on success. */}
          <Field label="Category" htmlFor="expense-category">
            {creatingCategory ? (
              <div className="flex gap-2">
                <input
                  id="expense-new-category"
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => {
                    setNewCategoryName(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreateCategory();
                    } else if (e.key === "Escape") {
                      setCreatingCategory(false);
                      setNewCategoryName("");
                      setError(null);
                    }
                  }}
                  placeholder="e.g., Booth Supplies"
                  autoFocus
                  disabled={creatingBusy}
                  className="flex-1 py-2 px-3 text-sm border border-blue-300 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateCategory()}
                  disabled={creatingBusy || !newCategoryName.trim()}
                  className="py-2 px-3 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold cursor-pointer border-0 disabled:opacity-60 inline-flex items-center gap-1.5"
                >
                  {creatingBusy && <Spinner size={11} color="white" />}
                  {creatingBusy ? "Adding..." : "Add"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingCategory(false);
                    setNewCategoryName("");
                    setError(null);
                  }}
                  disabled={creatingBusy}
                  className="py-2 px-3 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-medium cursor-pointer hover:bg-slate-50 disabled:opacity-40"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <select
                id="expense-category"
                value={category}
                onChange={(e) => {
                  if (e.target.value === "__create__") {
                    setCreatingCategory(true);
                    setNewCategoryName("");
                    setError(null);
                    return;
                  }
                  setCategory(e.target.value);
                  setError(null);
                }}
                disabled={saving}
                className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
              >
                <option value="">— pick a category —</option>
                {categories.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
                {onCreateCategory && (
                  <option value="__create__">
                    {"\u{2795}"} Create new category...
                  </option>
                )}
              </select>
            )}
          </Field>

          {/* Channel */}
          <Field label="Channel" htmlFor="expense-channel">
            <select
              id="expense-channel"
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value);
                // Clear event_id when channel moves off markets
                if (e.target.value !== "markets") setEventId("");
              }}
              disabled={saving}
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
            >
              <option value="">Overhead (not tied to a channel)</option>
              {EXPENSE_CHANNELS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1 m-0">
              Pick the channel this expense supports. &quot;Overhead&quot;
              for things like rent, software, accounting fees.
            </p>
          </Field>

          {/* Conditional event picker */}
          {showEventPicker && (
            <Field label="Event" htmlFor="expense-event">
              <select
                id="expense-event"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                disabled={saving}
                className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
              >
                <option value="">— pick a market event —</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.startDate})
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1 m-0">
                Optional, but linking lets per-event profit math
                include this expense.
              </p>
            </Field>
          )}

          {/* Notes */}
          <Field label="Notes (optional)" htmlFor="expense-notes">
            <textarea
              id="expense-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was this for?"
              rows={2}
              disabled={saving}
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 resize-y"
            />
          </Field>

          {/* Phase 9.4: Receipt attachments — drag-drop file area.
              Files are STAGED here and uploaded by the parent after
              the expense saves (so we have an expense id to attach
              to). Inline validation rejects unsupported types + size
              limit before they ever leave the browser. */}
          <Field label="Receipts (optional)" htmlFor="expense-files">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
                isDragOver
                  ? "border-blue-400 bg-blue-50"
                  : "border-slate-200 bg-slate-50/50"
              }`}
            >
              <input
                id="expense-files"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf"
                onChange={handleFileInputChange}
                disabled={saving}
                className="hidden"
              />
              <label
                htmlFor="expense-files"
                className={`text-xs text-slate-600 ${saving ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              >
                <span className="text-base mr-1.5">{"\u{1F4CE}"}</span>
                <span className="font-medium text-blue-600">
                  Click to add
                </span>
                <span> or drag receipts here</span>
                <p className="text-[10px] text-slate-400 m-0 mt-1">
                  JPEG · PNG · HEIC · WebP · PDF · 10 MB each
                </p>
              </label>
            </div>
            {files.length > 0 && (
              <ul className="m-0 mt-2 p-0 list-none space-y-1">
                {files.map((f, idx) => (
                  <li
                    key={`${f.name}-${f.size}-${idx}`}
                    className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-slate-50 border border-slate-100 text-xs"
                  >
                    <span className="truncate flex-1">
                      <span className="mr-1.5">{"\u{1F4C4}"}</span>
                      <span className="text-slate-700">{f.name}</span>
                      <span className="text-slate-400 ml-2">
                        {formatBytes(f.size)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFileAt(idx)}
                      disabled={saving}
                      className="text-slate-400 hover:text-red-600 bg-transparent border-0 cursor-pointer text-sm leading-none px-1 disabled:opacity-40"
                      aria-label={`Remove ${f.name}`}
                      title="Remove"
                    >
                      {"\u{00D7}"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="py-2 px-4 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer disabled:opacity-40 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving && <Spinner size={12} color="white" />}
            {saving ? "Saving..." : editing ? "Save changes" : "Save expense"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium text-slate-700 mb-1"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
