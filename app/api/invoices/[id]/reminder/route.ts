import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { sendEmail, arReminderEmail } from "@/lib/email";
import { computeAgingBucket, isOverdue } from "@/lib/aging";
import type { InvoiceRow } from "@/lib/invoices";
import { isPayingTier } from "@/lib/plans";

// Phase 6 (AR Aging & Follow-ups). Designed in
// session-notes/phase-6-ar-design.md §6 + §7.
//
// POST /api/invoices/[id]/reminder — send a follow-up email reminder.
//
// Validates four guards before sending:
//   1. customer_email is not null on the invoice
//   2. status is not 'paid' or 'written_off'
//   3. last_reminder_sent_at is more than 24h ago (or null)
//   4. reminder_count < 6 (cap per design §10 risk #2)
//
// Send path is Resend (per design §1 #3), Reply-To = the user's
// session email so the customer's reply threads back to the vendor.
//
// Race-condition note: a strict implementation would lock the invoice
// row, validate guards, send, update, commit — but holding a pg row
// lock during an external HTTP call (Resend) is a bad idea. We accept
// a small race where two concurrent POSTs could both pass the 24h
// guard and double-send. The 6-cap + 24h delay make this unlikely,
// and the cost (one extra reminder) is bounded.

function isPlanAllowed(plan: string | null | undefined): boolean {
  return isPayingTier(plan);
}

function parsePositiveInt(rawId: string): number | null {
  const n = Number(rawId);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const REMINDER_CAP = 6;

function computeDaysOverdue(dueDate: string, today: Date = new Date()): number {
  const due = new Date(`${dueDate}T00:00:00Z`).getTime();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  return Math.floor((todayUtc - due) / 86400000);
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const invoiceId = parsePositiveInt(rawId);
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

    // Load the invoice (no lock — see top-of-file race note).
    const invResult = await pool.query<InvoiceRow>(
      `SELECT id, client_id, customer_name, customer_email, invoice_number,
              invoice_date, due_date, amount_total, amount_paid, status,
              notes, last_reminder_sent_at, reminder_count,
              created_at, updated_at
         FROM invoices
        WHERE id = $1 AND client_id = $2`,
      [invoiceId, client.id]
    );
    if (invResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Invoice not found" },
        { status: 404 }
      );
    }
    const inv = invResult.rows[0];

    // Guard 1: customer email required.
    if (!inv.customer_email || inv.customer_email.trim().length === 0) {
      return NextResponse.json(
        { error: "Add a customer email on the invoice before sending a reminder" },
        { status: 400 }
      );
    }

    // Guard 2: not terminal.
    if (inv.status === "paid" || inv.status === "written_off") {
      return NextResponse.json(
        {
          error: `Cannot send a reminder for an invoice that is ${inv.status}`,
        },
        { status: 400 }
      );
    }

    // Guard 3: 24h cooldown.
    if (inv.last_reminder_sent_at) {
      const last = new Date(inv.last_reminder_sent_at).getTime();
      const elapsed = Date.now() - last;
      if (elapsed < REMINDER_COOLDOWN_MS) {
        const hoursLeft = Math.ceil(
          (REMINDER_COOLDOWN_MS - elapsed) / (60 * 60 * 1000)
        );
        return NextResponse.json(
          {
            error: `A reminder was sent recently. Wait ${hoursLeft} more hour${hoursLeft === 1 ? "" : "s"} before re-sending.`,
          },
          { status: 400 }
        );
      }
    }

    // Guard 4: cap.
    if (inv.reminder_count >= REMINDER_CAP) {
      return NextResponse.json(
        {
          error: `This invoice has hit the ${REMINDER_CAP}-reminder cap. Contact the customer directly.`,
        },
        { status: 400 }
      );
    }

    // Build + send.
    const businessName =
      typeof client.business_name === "string" &&
      client.business_name.trim().length > 0
        ? client.business_name.trim()
        : "your supplier";
    const amountOutstanding =
      Number(inv.amount_total) - Number(inv.amount_paid);
    const daysOverdue = computeDaysOverdue(inv.due_date);

    const email = arReminderEmail({
      businessName,
      customerName: inv.customer_name,
      invoiceNumber: inv.invoice_number,
      amountOutstanding,
      dueDate: inv.due_date,
      daysOverdue,
    });

    // Reply-To = the user's own email so customer replies route back
    // to the vendor (design §1 #3). client.email comes from the
    // clients row (Google OAuth email).
    const replyTo =
      typeof client.email === "string" && client.email.trim().length > 0
        ? client.email.trim()
        : undefined;

    try {
      await sendEmail({
        to: inv.customer_email,
        subject: email.subject,
        html: email.html,
        replyTo,
      });
    } catch (err) {
      // Resend failure → 502 with the underlying error. Do NOT bump
      // reminder_count or last_reminder_sent_at; the email never went.
      const detail = err instanceof Error ? err.message : "unknown send error";
      console.error("Reminder send failed:", detail);
      return NextResponse.json(
        { error: `Couldn't send reminder: ${detail}` },
        { status: 502 }
      );
    }

    // Bump counters only after a successful send.
    const updateResult = await pool.query<InvoiceRow>(
      `UPDATE invoices
          SET reminder_count = reminder_count + 1,
              last_reminder_sent_at = NOW(),
              updated_at = NOW()
        WHERE id = $1 AND client_id = $2
      RETURNING id, client_id, customer_name, customer_email, invoice_number,
                invoice_date, due_date, amount_total, amount_paid, status,
                notes, last_reminder_sent_at, reminder_count,
                created_at, updated_at`,
      [invoiceId, client.id]
    );

    return NextResponse.json({
      invoice: serializeInvoice(updateResult.rows[0]),
    });
  } catch (error) {
    console.error("Reminder POST error:", error);
    return NextResponse.json(
      { error: "Failed to send reminder" },
      { status: 500 }
    );
  }
}
