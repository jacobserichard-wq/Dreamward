// app/api/invoices/[id]/send/route.ts
//
// POST /api/invoices/[id]/send — email the customer their actual invoice
// (amount due, due date, invoice number, optional note). This is the
// "Send invoice" action — distinct from /reminder, which sends an overdue
// follow-up. No cooldown/cap (those are reminder rate-limits); you can
// re-send an invoice whenever.
//
// Guards: customer_email present; invoice not written_off. Reply-To is the
// vendor's own email so the customer's reply threads back to them.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { sendEmail, invoiceEmail } from "@/lib/email";
import type { InvoiceRow } from "@/lib/invoices";
import { isPayingTier } from "@/lib/plans";

function parsePositiveInt(rawId: string): number | null {
  const n = Number(rawId);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const invoiceId = parsePositiveInt(rawId);
    if (invoiceId === null) {
      return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
    }

    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "AR is a Growth or Pro feature" },
        { status: 403 }
      );
    }

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
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    const inv = invResult.rows[0];

    if (!inv.customer_email || inv.customer_email.trim().length === 0) {
      return NextResponse.json(
        { error: "Add a customer email on the invoice before sending it" },
        { status: 400 }
      );
    }
    if (inv.status === "written_off") {
      return NextResponse.json(
        { error: "Can't send a written-off invoice" },
        { status: 400 }
      );
    }

    const businessName =
      typeof client.business_name === "string" &&
      client.business_name.trim().length > 0
        ? client.business_name.trim()
        : "your supplier";
    const amountDue = Number(inv.amount_total) - Number(inv.amount_paid);

    const email = invoiceEmail({
      businessName,
      customerName: inv.customer_name,
      invoiceNumber: inv.invoice_number,
      amountDue,
      dueDate: inv.due_date,
      notes: inv.notes,
    });

    // Reply-To = the vendor's own email so the customer's reply reaches them.
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
      const detail = err instanceof Error ? err.message : "unknown send error";
      console.error("Invoice send failed:", detail);
      return NextResponse.json(
        { error: `Couldn't send invoice: ${detail}` },
        { status: 502 }
      );
    }

    // Stamp when the invoice was sent (powers the "Sent <when>" indicator).
    await pool.query(
      `UPDATE invoices SET invoice_sent_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND client_id = $2`,
      [invoiceId, client.id]
    );

    return NextResponse.json({ sent: true, to: inv.customer_email });
  } catch (error) {
    console.error("Invoice send POST error:", error);
    return NextResponse.json(
      { error: "Failed to send invoice" },
      { status: 500 }
    );
  }
}
