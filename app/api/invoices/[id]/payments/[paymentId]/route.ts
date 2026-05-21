import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import {
  deletePayment,
  InvoiceNotFoundError,
  PaymentNotFoundError,
  type InvoiceRow,
} from "@/lib/invoices";
import { computeAgingBucket, isOverdue } from "@/lib/aging";

// Phase 6 (AR Aging & Follow-ups). Designed in
// session-notes/phase-6-ar-design.md §6.
//
// DELETE /api/invoices/[id]/payments/[paymentId]  — back out a payment.
//
// Used to reverse a mis-entered payment. The UI MUST double-confirm
// before calling (design §8 detail-page mockup). Thin HTTP adapter
// over lib/invoices.deletePayment, which transactionally:
//   - locks the invoice row (SELECT ... FOR UPDATE)
//   - SELECTs the payment (to get its amount + verify tenant)
//   - DELETEs the payment
//   - decrements invoices.amount_paid
//   - re-derives invoices.status
//
// Error mapping:
//   InvoiceNotFoundError → 404 (invoice not in this tenant)
//   PaymentNotFoundError → 404 (payment not on this invoice in this tenant)

function isPlanAllowed(plan: string | null | undefined): boolean {
  return plan === "growth" || plan === "pro" || plan === "trial";
}

function parsePositiveInt(rawId: string): number | null {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  try {
    const { id: rawId, paymentId: rawPaymentId } = await params;
    const invoiceId = parsePositiveInt(rawId);
    const paymentId = parsePositiveInt(rawPaymentId);
    if (invoiceId === null) {
      return NextResponse.json(
        { error: "Invalid invoice id" },
        { status: 400 }
      );
    }
    if (paymentId === null) {
      return NextResponse.json(
        { error: "Invalid payment id" },
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

    let result: { invoice: InvoiceRow };
    try {
      result = await deletePayment({
        invoiceId,
        clientId: client.id,
        paymentId,
      });
    } catch (err) {
      if (err instanceof InvoiceNotFoundError) {
        return NextResponse.json(
          { error: "Invoice not found" },
          { status: 404 }
        );
      }
      if (err instanceof PaymentNotFoundError) {
        return NextResponse.json(
          { error: "Payment not found on this invoice" },
          { status: 404 }
        );
      }
      throw err;
    }

    return NextResponse.json({ invoice: serializeInvoice(result.invoice) });
  } catch (error) {
    console.error("Payment DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete payment" },
      { status: 500 }
    );
  }
}
