import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import type { InvoiceRow, InvoiceStatus } from "@/lib/invoices";
import {
  computeAgingBucket,
  AGING_BUCKETS_ORDERED,
  isOverdue,
  type AgingBucket,
} from "@/lib/aging";

// Phase 6 (AR Aging & Follow-ups). Designed in
// session-notes/phase-6-ar-design.md §6.
//
// GET /api/invoices   — list, scoped by client_id, with computed summary
// POST /api/invoices  — create new invoice (manual entry)
//
// Plan gating matches the events-route precedent: trial users get to
// evaluate the feature (Growth/Pro is the canonical lib/plans.ts gate;
// trial is a courtesy preview). API enforces — never trust the UI alone.

interface CreateInvoiceBody {
  customerName?: unknown;
  customerEmail?: unknown;
  invoiceNumber?: unknown;
  invoiceDate?: unknown;
  dueDate?: unknown;
  amountTotal?: unknown;
  notes?: unknown;
}

// Defense-in-depth at the API: accept "$340", "340", "340.00", and
// numbers. UI does the same parsing before submit; this catches
// malformed direct API calls without rejecting reasonable input.
function parseMoney(v: unknown): number | null {
  if (v == null || v === "") return null;
  const cleaned =
    typeof v === "number" ? String(v) : String(v).replace(/[$,\s]/g, "");
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function isValidISODate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// Lax email check — single @, no full RFC 5322. Just enough to catch
// fat-finger typos before sending to Resend at reminder time.
function isValidEmail(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const trimmed = v.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function isPlanAllowed(plan: string | null | undefined): boolean {
  return plan === "growth" || plan === "pro" || plan === "trial";
}

// Each invoice row in the list/create response. Camel-case at the API
// boundary, NUMERIC strings converted to plain JS numbers. Adds two
// computed fields not in the DB: amountOutstanding (= total - paid) and
// agingBucket (from lib/aging.ts).
function serializeInvoice(row: InvoiceRow, today: Date = new Date()) {
  const amountTotal = Number(row.amount_total);
  const amountPaid = Number(row.amount_paid);
  const amountOutstanding = amountTotal - amountPaid;
  const agingBucket = computeAgingBucket(row, today);
  return {
    id: row.id,
    clientId: row.client_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    amountTotal,
    amountPaid,
    amountOutstanding,
    status: row.status,
    agingBucket,
    notes: row.notes,
    lastReminderSentAt: row.last_reminder_sent_at,
    reminderCount: row.reminder_count,
    // Phase 6.5 commit 6: surface the new columns so the UI can badge
    // auto-detected rows and the review-queue filter chip can count
    // needs_review separately from the aging buckets.
    source: row.source,
    gmailMessageId: row.gmail_message_id,
    needsReview: row.needs_review,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type SerializedInvoice = ReturnType<typeof serializeInvoice>;

// Summary block computed across the (filtered) result set. Drives the
// dashboard outstanding-balance card and the bucket-chip totals on the
// /invoices list page — design §8.
function buildSummary(invoices: SerializedInvoice[]) {
  const bucketTotals: Record<AgingBucket, { count: number; amount: number }> = {
    "Paid": { count: 0, amount: 0 },
    "Written off": { count: 0, amount: 0 },
    "Current": { count: 0, amount: 0 },
    "1–30 days": { count: 0, amount: 0 },
    "31–60 days": { count: 0, amount: 0 },
    "61–90 days": { count: 0, amount: 0 },
    "91+ days": { count: 0, amount: 0 },
  };
  let totalOutstanding = 0;
  let overdueOutstanding = 0;
  // Phase 6.5 commit 6: count of needs_review rows for the filter
  // chip label ("Needs review (3)"). Excluded from the regular aging
  // buckets so the chip is the single source of truth for review state.
  let needsReviewCount = 0;
  for (const inv of invoices) {
    const bucket = inv.agingBucket;
    bucketTotals[bucket].count += 1;
    bucketTotals[bucket].amount += inv.amountOutstanding;
    if (inv.status !== "paid" && inv.status !== "written_off") {
      totalOutstanding += inv.amountOutstanding;
      if (isOverdue(bucket)) overdueOutstanding += inv.amountOutstanding;
    }
    if (inv.needsReview) needsReviewCount += 1;
  }
  return {
    totalOutstanding,
    overdueOutstanding,
    bucketTotals,
    bucketOrder: AGING_BUCKETS_ORDERED,
    needsReviewCount,
  };
}

export async function GET(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPlanAllowed(client.plan)) {
      return NextResponse.json(
        { error: "AR is a Growth or Pro feature" },
        { status: 403 }
      );
    }

    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const agingParam = url.searchParams.get("aging");
    const customerParam = url.searchParams.get("customer");
    const limitParam = url.searchParams.get("limit");
    const offsetParam = url.searchParams.get("offset");

    // Validate status filter — only accept the four known values.
    const allowedStatus = new Set<InvoiceStatus>([
      "open",
      "partial",
      "paid",
      "written_off",
    ]);
    if (statusParam && !allowedStatus.has(statusParam as InvoiceStatus)) {
      return NextResponse.json(
        { error: "status must be one of: open, partial, paid, written_off" },
        { status: 400 }
      );
    }

    // Validate aging filter — three broad categories. Specific bucket
    // filtering happens client-side via bucketTotals.
    const allowedAging = new Set(["current", "overdue", "paid"]);
    if (agingParam && !allowedAging.has(agingParam)) {
      return NextResponse.json(
        { error: "aging must be one of: current, overdue, paid" },
        { status: 400 }
      );
    }

    // Pagination — clamp to sane bounds.
    let limit = 200;
    if (limitParam) {
      const n = Number(limitParam);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        return NextResponse.json(
          { error: "limit must be an integer between 1 and 1000" },
          { status: 400 }
        );
      }
      limit = n;
    }
    let offset = 0;
    if (offsetParam) {
      const n = Number(offsetParam);
      if (!Number.isInteger(n) || n < 0) {
        return NextResponse.json(
          { error: "offset must be a non-negative integer" },
          { status: 400 }
        );
      }
      offset = n;
    }

    // Build the SQL — status + customer filters are SQL-level (cheaper
    // at scale), aging filter is JS-level (depends on derived bucket).
    const whereParts: string[] = ["client_id = $1"];
    const values: unknown[] = [client.id];
    let p = 2;
    if (statusParam) {
      whereParts.push(`status = $${p++}`);
      values.push(statusParam);
    }
    if (customerParam) {
      whereParts.push(`customer_name ILIKE $${p++}`);
      values.push(`%${customerParam}%`);
    }

    const result = await pool.query<InvoiceRow>(
      `SELECT id, client_id, customer_name, customer_email, invoice_number,
              invoice_date, due_date, amount_total, amount_paid, status,
              notes, last_reminder_sent_at, reminder_count,
              source, gmail_message_id, needs_review,
              created_at, updated_at
         FROM invoices
        WHERE ${whereParts.join(" AND ")}
        ORDER BY due_date ASC, id DESC
        LIMIT $${p++} OFFSET $${p++}`,
      [...values, limit, offset]
    );

    const today = new Date();
    let serialized = result.rows.map((r) => serializeInvoice(r, today));

    // Aging filter is JS-level — applied after serializing so we have
    // the derived bucket label to compare against.
    if (agingParam === "current") {
      serialized = serialized.filter((i) => i.agingBucket === "Current");
    } else if (agingParam === "overdue") {
      serialized = serialized.filter((i) => isOverdue(i.agingBucket));
    } else if (agingParam === "paid") {
      serialized = serialized.filter((i) => i.agingBucket === "Paid");
    }

    return NextResponse.json({
      invoices: serialized,
      summary: buildSummary(serialized),
    });
  } catch (error) {
    console.error("Invoices GET error:", error);
    return NextResponse.json(
      { error: "Failed to load invoices" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPlanAllowed(client.plan)) {
      return NextResponse.json(
        { error: "AR is a Growth or Pro feature" },
        { status: 403 }
      );
    }

    let body: CreateInvoiceBody;
    try {
      body = (await req.json()) as CreateInvoiceBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (!isNonEmptyString(body.customerName)) {
      return NextResponse.json(
        { error: "customerName is required" },
        { status: 400 }
      );
    }
    const customerName = body.customerName.trim();

    let customerEmail: string | null = null;
    if (
      body.customerEmail !== undefined &&
      body.customerEmail !== null &&
      body.customerEmail !== ""
    ) {
      if (!isValidEmail(body.customerEmail)) {
        return NextResponse.json(
          { error: "customerEmail must be a valid email" },
          { status: 400 }
        );
      }
      customerEmail = (body.customerEmail as string).trim();
    }

    const invoiceNumber =
      typeof body.invoiceNumber === "string" &&
      body.invoiceNumber.trim().length > 0
        ? body.invoiceNumber.trim()
        : null;

    if (!isValidISODate(body.invoiceDate)) {
      return NextResponse.json(
        { error: "invoiceDate must be a YYYY-MM-DD string" },
        { status: 400 }
      );
    }
    const invoiceDate = body.invoiceDate;

    if (!isValidISODate(body.dueDate)) {
      return NextResponse.json(
        { error: "dueDate must be a YYYY-MM-DD string" },
        { status: 400 }
      );
    }
    const dueDate = body.dueDate;

    if (dueDate < invoiceDate) {
      return NextResponse.json(
        { error: "dueDate must be on or after invoiceDate" },
        { status: 400 }
      );
    }

    const amountTotal = parseMoney(body.amountTotal);
    if (amountTotal === null || amountTotal <= 0) {
      return NextResponse.json(
        { error: "amountTotal must be a positive number" },
        { status: 400 }
      );
    }

    const notes =
      typeof body.notes === "string" && body.notes.trim().length > 0
        ? body.notes.trim()
        : null;

    const result = await pool.query<InvoiceRow>(
      `INSERT INTO invoices
         (client_id, customer_name, customer_email, invoice_number,
          invoice_date, due_date, amount_total, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, client_id, customer_name, customer_email, invoice_number,
                 invoice_date, due_date, amount_total, amount_paid, status,
                 notes, last_reminder_sent_at, reminder_count,
                 created_at, updated_at`,
      [
        client.id,
        customerName,
        customerEmail,
        invoiceNumber,
        invoiceDate,
        dueDate,
        amountTotal,
        notes,
      ]
    );

    return NextResponse.json(
      { invoice: serializeInvoice(result.rows[0]) },
      { status: 201 }
    );
  } catch (error) {
    console.error("Invoices POST error:", error);
    return NextResponse.json(
      { error: "Failed to create invoice" },
      { status: 500 }
    );
  }
}
