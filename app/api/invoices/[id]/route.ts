import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import {
  deriveStatus,
  type InvoiceRow,
  type InvoicePaymentRow,
  type InvoiceStatus,
} from "@/lib/invoices";
import { computeAgingBucket, isOverdue } from "@/lib/aging";

// Phase 6 (AR Aging & Follow-ups). Designed in
// session-notes/phase-6-ar-design.md §6.
//
// GET    /api/invoices/[id]  — single invoice + payment history
// PATCH  /api/invoices/[id]  — edit metadata, amounts, dates, status
// DELETE /api/invoices/[id]  — hard delete; invoice_payments cascades;
//                              processed_items.invoice_id nulled in
//                              the same transaction (mirror Phase 3
//                              events DELETE precedent).

interface PatchInvoiceBody {
  customerName?: unknown;
  customerEmail?: unknown;
  invoiceNumber?: unknown;
  invoiceDate?: unknown;
  dueDate?: unknown;
  amountTotal?: unknown;
  notes?: unknown;
  status?: unknown;
}

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

function isValidEmail(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function isPlanAllowed(plan: string | null | undefined): boolean {
  return plan === "growth" || plan === "pro" || plan === "trial";
}

function parseInvoiceId(rawId: string): number | null {
  const n = Number(rawId);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

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
    isOverdue: isOverdue(agingBucket),
    notes: row.notes,
    lastReminderSentAt: row.last_reminder_sent_at,
    reminderCount: row.reminder_count,
    // Phase 6.5 commit 6: ingest-source columns surfaced for the
    // detail-page banner + "view original email" deep-link.
    source: row.source,
    gmailMessageId: row.gmail_message_id,
    needsReview: row.needs_review,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializePayment(row: InvoicePaymentRow) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    amount: Number(row.amount),
    paidAt: row.paid_at,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const invoiceId = parseInvoiceId(rawId);
    if (invoiceId === null) {
      return NextResponse.json(
        { error: "Invalid invoice id" },
        { status: 400 }
      );
    }

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

    const invoiceResult = await pool.query<InvoiceRow>(
      `SELECT id, client_id, customer_name, customer_email, invoice_number,
              invoice_date, due_date, amount_total, amount_paid, status,
              notes, last_reminder_sent_at, reminder_count,
              created_at, updated_at
         FROM invoices
        WHERE id = $1 AND client_id = $2`,
      [invoiceId, client.id]
    );
    if (invoiceResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Invoice not found" },
        { status: 404 }
      );
    }

    const paymentsResult = await pool.query<InvoicePaymentRow>(
      `SELECT id, invoice_id, client_id, amount, paid_at, method,
              reference, notes, created_at
         FROM invoice_payments
        WHERE invoice_id = $1 AND client_id = $2
        ORDER BY paid_at DESC, id DESC`,
      [invoiceId, client.id]
    );

    return NextResponse.json({
      invoice: serializeInvoice(invoiceResult.rows[0]),
      payments: paymentsResult.rows.map(serializePayment),
    });
  } catch (error) {
    console.error("Invoice GET error:", error);
    return NextResponse.json(
      { error: "Failed to load invoice" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const invoiceId = parseInvoiceId(rawId);
    if (invoiceId === null) {
      return NextResponse.json(
        { error: "Invalid invoice id" },
        { status: 400 }
      );
    }

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

    let body: PatchInvoiceBody;
    try {
      body = (await req.json()) as PatchInvoiceBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Dynamic UPDATE — only include fields the caller sent.
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    // Track date range for cross-field validation (need to compare
    // against current row values for the side not being updated).
    let invoiceDateForRangeCheck: string | undefined;
    let dueDateForRangeCheck: string | undefined;

    // Track amount/status changes so we can re-derive status if either
    // changed. amount_total changes also need to be reconciled against
    // amount_paid (the new total must >= amount_paid; otherwise the
    // invoice is suddenly overpaid).
    let newAmountTotal: number | undefined;
    let explicitStatus: InvoiceStatus | undefined;

    if (body.customerName !== undefined) {
      if (!isNonEmptyString(body.customerName)) {
        return NextResponse.json(
          { error: "customerName must be a non-empty string" },
          { status: 400 }
        );
      }
      setClauses.push(`customer_name = $${i++}`);
      values.push(body.customerName.trim());
    }

    if (body.customerEmail !== undefined) {
      if (body.customerEmail === null || body.customerEmail === "") {
        setClauses.push(`customer_email = $${i++}`);
        values.push(null);
      } else {
        if (!isValidEmail(body.customerEmail)) {
          return NextResponse.json(
            { error: "customerEmail must be a valid email" },
            { status: 400 }
          );
        }
        setClauses.push(`customer_email = $${i++}`);
        values.push((body.customerEmail as string).trim());
      }
    }

    if (body.invoiceNumber !== undefined) {
      const trimmed =
        typeof body.invoiceNumber === "string" &&
        body.invoiceNumber.trim().length > 0
          ? body.invoiceNumber.trim()
          : null;
      setClauses.push(`invoice_number = $${i++}`);
      values.push(trimmed);
    }

    if (body.invoiceDate !== undefined) {
      if (!isValidISODate(body.invoiceDate)) {
        return NextResponse.json(
          { error: "invoiceDate must be a YYYY-MM-DD string" },
          { status: 400 }
        );
      }
      setClauses.push(`invoice_date = $${i++}`);
      values.push(body.invoiceDate);
      invoiceDateForRangeCheck = body.invoiceDate;
    }

    if (body.dueDate !== undefined) {
      if (!isValidISODate(body.dueDate)) {
        return NextResponse.json(
          { error: "dueDate must be a YYYY-MM-DD string" },
          { status: 400 }
        );
      }
      setClauses.push(`due_date = $${i++}`);
      values.push(body.dueDate);
      dueDateForRangeCheck = body.dueDate;
    }

    if (body.amountTotal !== undefined) {
      const parsed = parseMoney(body.amountTotal);
      if (parsed === null || parsed <= 0) {
        return NextResponse.json(
          { error: "amountTotal must be a positive number" },
          { status: 400 }
        );
      }
      newAmountTotal = parsed;
      setClauses.push(`amount_total = $${i++}`);
      values.push(parsed);
    }

    if (body.notes !== undefined) {
      const notes =
        typeof body.notes === "string" && body.notes.trim().length > 0
          ? body.notes.trim()
          : null;
      setClauses.push(`notes = $${i++}`);
      values.push(notes);
    }

    // Status edits are constrained: callers can flip to 'written_off',
    // or revert back to 'open'/'partial'. 'paid' is derived from
    // amount_paid >= amount_total — direct PATCH to 'paid' would let
    // the caller silently mark an underpaid invoice as paid, breaking
    // the audit trail. Reject it.
    if (body.status !== undefined) {
      const allowed: InvoiceStatus[] = ["open", "partial", "written_off"];
      if (
        typeof body.status !== "string" ||
        !allowed.includes(body.status as InvoiceStatus)
      ) {
        return NextResponse.json(
          {
            error:
              "status may only be set to: open, partial, written_off. " +
              "'paid' is derived from amount_paid and amount_total.",
          },
          { status: 400 }
        );
      }
      explicitStatus = body.status as InvoiceStatus;
      setClauses.push(`status = $${i++}`);
      values.push(body.status);
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    // Date range cross-field validation. Need the current values for
    // any side not being updated.
    if (
      invoiceDateForRangeCheck !== undefined ||
      dueDateForRangeCheck !== undefined
    ) {
      const currentResult = await pool.query<InvoiceRow>(
        `SELECT invoice_date, due_date FROM invoices
          WHERE id = $1 AND client_id = $2`,
        [invoiceId, client.id]
      );
      if (currentResult.rows.length === 0) {
        return NextResponse.json(
          { error: "Invoice not found" },
          { status: 404 }
        );
      }
      const finalInvoiceDate =
        invoiceDateForRangeCheck ?? currentResult.rows[0].invoice_date;
      const finalDueDate =
        dueDateForRangeCheck ?? currentResult.rows[0].due_date;
      if (finalDueDate < finalInvoiceDate) {
        return NextResponse.json(
          { error: "dueDate must be on or after invoiceDate" },
          { status: 400 }
        );
      }
    }

    setClauses.push(`updated_at = NOW()`);

    // Transaction-wrap the amount_total reconciliation + UPDATE so the
    // existingPaid read and the UPDATE write happen atomically against
    // concurrent recordPayment / deletePayment writes (which also use
    // SELECT ... FOR UPDATE on the same row). Without this lock, a TOC-
    // TTOU race could pass the overpayment-guard validation here while
    // a parallel payment write moves amount_paid past the new
    // amount_total — leaving amount_paid > amount_total post-commit.
    // Identified during the sub-session 20 pre-push audit
    // (session-notes/audit-phase-6-ar-prebuild-review.md SHIP-FIX #1).
    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");

      if (newAmountTotal !== undefined) {
        const currentResult = await dbClient.query<InvoiceRow>(
          `SELECT amount_paid, status FROM invoices
            WHERE id = $1 AND client_id = $2
            FOR UPDATE`,
          [invoiceId, client.id]
        );
        if (currentResult.rows.length === 0) {
          await dbClient.query("ROLLBACK");
          return NextResponse.json(
            { error: "Invoice not found" },
            { status: 404 }
          );
        }
        const existingPaid = Number(currentResult.rows[0].amount_paid);
        if (newAmountTotal < existingPaid - 1e-9) {
          await dbClient.query("ROLLBACK");
          return NextResponse.json(
            {
              error: `amountTotal (${newAmountTotal}) cannot be less than ` +
                `amount already paid (${existingPaid}). Delete payments first ` +
                `or write off the difference.`,
            },
            { status: 400 }
          );
        }
        // Re-derive status from (newTotal, existingPaid, currentStatus).
        // If the caller ALSO sent explicit status, theirs wins for the
        // non-derived ones (written_off); the derived ones (open/partial/paid)
        // come from the math.
        if (explicitStatus !== "written_off") {
          const derived = deriveStatus(
            newAmountTotal,
            existingPaid,
            currentResult.rows[0].status as InvoiceStatus
          );
          // Find and overwrite the status clause if it was already pushed;
          // otherwise append a new one.
          const statusIdx = setClauses.findIndex((c) =>
            c.startsWith("status = ")
          );
          if (statusIdx >= 0) {
            // Overwrite the existing setClause/value with the derived
            // status. The placeholder index is preserved in the SQL, so we
            // just swap the value at the same array index.
            const placeholderMatch = setClauses[statusIdx].match(/\$(\d+)/);
            if (placeholderMatch) {
              const placeholderIdx = Number(placeholderMatch[1]) - 1;
              values[placeholderIdx] = derived;
            }
          } else {
            setClauses.push(`status = $${i++}`);
            values.push(derived);
          }
        }
      }

      const result = await dbClient.query<InvoiceRow>(
        `UPDATE invoices
            SET ${setClauses.join(", ")}
          WHERE id = $${i++} AND client_id = $${i++}
        RETURNING id, client_id, customer_name, customer_email, invoice_number,
                  invoice_date, due_date, amount_total, amount_paid, status,
                  notes, last_reminder_sent_at, reminder_count,
                  created_at, updated_at`,
        [...values, invoiceId, client.id]
      );
      if (result.rows.length === 0) {
        await dbClient.query("ROLLBACK");
        return NextResponse.json(
          { error: "Invoice not found" },
          { status: 404 }
        );
      }

      await dbClient.query("COMMIT");
      return NextResponse.json({ invoice: serializeInvoice(result.rows[0]) });
    } catch (txErr) {
      await dbClient.query("ROLLBACK").catch(() => undefined);
      throw txErr;
    } finally {
      dbClient.release();
    }
  } catch (error) {
    console.error("Invoice PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update invoice" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const invoiceId = parseInvoiceId(rawId);
    if (invoiceId === null) {
      return NextResponse.json(
        { error: "Invalid invoice id" },
        { status: 400 }
      );
    }

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

    // Two-step in a transaction (mirrors Phase 3 events DELETE):
    //   1. Null out invoice_id on any linked processed_items rows. The
    //      FK is non-cascade by design (design §10 risk #6) — the
    //      ingested email/CSV rows survive invoice delete.
    //   2. Delete the invoice. invoice_payments cascades via the FK's
    //      ON DELETE CASCADE.
    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");

      await dbClient.query(
        `UPDATE processed_items
            SET invoice_id = NULL
          WHERE invoice_id = $1 AND client_id = $2`,
        [invoiceId, client.id]
      );

      const deleteResult = await dbClient.query(
        `DELETE FROM invoices WHERE id = $1 AND client_id = $2`,
        [invoiceId, client.id]
      );
      if ((deleteResult.rowCount ?? 0) === 0) {
        await dbClient.query("ROLLBACK");
        return NextResponse.json(
          { error: "Invoice not found" },
          { status: 404 }
        );
      }

      await dbClient.query("COMMIT");
      return NextResponse.json({ success: true });
    } catch (txErr) {
      await dbClient.query("ROLLBACK");
      throw txErr;
    } finally {
      dbClient.release();
    }
  } catch (error) {
    console.error("Invoice DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete invoice" },
      { status: 500 }
    );
  }
}
