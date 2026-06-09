import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import {
  recordPayment,
  InvoiceNotFoundError,
  OverpaymentError,
  type InvoiceRow,
  type InvoicePaymentRow,
} from "@/lib/invoices";
import { computeAgingBucket, isOverdue } from "@/lib/aging";
import { isPayingTier } from "@/lib/plans";

// Phase 6 (AR Aging & Follow-ups). Designed in
// session-notes/phase-6-ar-design.md §6.
//
// POST /api/invoices/[id]/payments — record a payment against an invoice.
//
// Thin HTTP adapter. All the integrity-critical work (transactional
// insert + amount_paid bump + status flip, with SELECT ... FOR UPDATE
// locking) lives in lib/invoices.ts:recordPayment. This route only:
//   1. Authenticates + plan-gates.
//   2. Parses + validates the body.
//   3. Calls recordPayment.
//   4. Maps lib errors to HTTP codes:
//        InvoiceNotFoundError → 404
//        OverpaymentError     → 400 (with the helpful overpaid-by-N msg)
//   5. Serializes the response.

interface PaymentBody {
  amount?: unknown;
  paidAt?: unknown;
  method?: unknown;
  reference?: unknown;
  notes?: unknown;
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

function isPlanAllowed(plan: string | null | undefined): boolean {
  return isPayingTier(plan);
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

export async function POST(
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

    let body: PaymentBody;
    try {
      body = (await req.json()) as PaymentBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const amount = parseMoney(body.amount);
    if (amount === null || amount <= 0) {
      return NextResponse.json(
        { error: "amount must be a positive number" },
        { status: 400 }
      );
    }

    if (!isValidISODate(body.paidAt)) {
      return NextResponse.json(
        { error: "paidAt must be a YYYY-MM-DD string" },
        { status: 400 }
      );
    }
    const paidAt = body.paidAt;

    const method =
      typeof body.method === "string" && body.method.trim().length > 0
        ? body.method.trim()
        : null;
    const reference =
      typeof body.reference === "string" && body.reference.trim().length > 0
        ? body.reference.trim()
        : null;
    const notes =
      typeof body.notes === "string" && body.notes.trim().length > 0
        ? body.notes.trim()
        : null;

    let result: { invoice: InvoiceRow; payment: InvoicePaymentRow };
    try {
      result = await recordPayment({
        invoiceId,
        clientId: client.id,
        amount,
        paidAt,
        method,
        reference,
        notes,
      });
    } catch (err) {
      if (err instanceof InvoiceNotFoundError) {
        return NextResponse.json(
          { error: "Invoice not found" },
          { status: 404 }
        );
      }
      if (err instanceof OverpaymentError) {
        // err.message already carries the "Payment of X exceeds
        // outstanding balance of Y" copy from the error class.
        return NextResponse.json(
          {
            error: err.message,
            outstanding: err.outstanding,
            attempted: err.attempted,
          },
          { status: 400 }
        );
      }
      throw err;
    }

    return NextResponse.json(
      {
        invoice: serializeInvoice(result.invoice),
        payment: serializePayment(result.payment),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Payment POST error:", error);
    return NextResponse.json(
      { error: "Failed to record payment" },
      { status: 500 }
    );
  }
}
