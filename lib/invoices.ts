// lib/invoices.ts
//
// Blessed write path for invoice payments. Per phase-6-ar-design.md §5,
// every payment-mutation must transactionally update both:
//   - invoice_payments    (the audit-trail row)
//   - invoices.amount_paid (the denormalized running total)
//   - invoices.status      (derived: open | partial | paid)
// API routes MUST call recordPayment / deletePayment in this file; they
// must NOT write invoice_payments + invoices.amount_paid directly.
//
// Why denormalize amount_paid (design §3): a SUM(invoice_payments.amount)
// view would be cleaner, but every list-page query would pay a join +
// aggregate cost. Denormalize once at write time, read cheap.
//
// Why one file: keeping the two write helpers + deriveStatus together
// gives a single audit surface for the integrity-critical paths. Plain
// CRUD (create / update / delete invoice metadata) stays in the API
// route — single-table SQL, no transaction risk.

import pool from "./db";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type InvoiceStatus = "open" | "partial" | "paid" | "written_off";

export interface InvoiceRow {
  id: number;
  client_id: number;
  customer_name: string;
  customer_email: string | null;
  invoice_number: string | null;
  invoice_date: string;        // YYYY-MM-DD per pg DATE-parser override
  due_date: string;            // YYYY-MM-DD
  amount_total: string;        // pg NUMERIC comes as string
  amount_paid: string;
  status: InvoiceStatus;
  notes: string | null;
  last_reminder_sent_at: string | null;
  reminder_count: number;
  created_at: string;
  updated_at: string;
  // Phase 6.5 (sub-session 24): three columns from migration 0009.
  // Defaults preserve existing manual rows — source='manual',
  // gmail_message_id=null, needs_review=false.
  source: "manual" | "email-auto";
  gmail_message_id: string | null;
  needs_review: boolean;
}

export interface InvoicePaymentRow {
  id: number;
  invoice_id: number;
  client_id: number;
  amount: string;              // pg NUMERIC comes as string
  paid_at: string;             // YYYY-MM-DD
  method: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------
// Error classes — API routes pattern-match on these to return the right
// HTTP status without leaking internals.
// ---------------------------------------------------------------------

export class InvoiceNotFoundError extends Error {
  constructor(public readonly invoiceId: number) {
    super(`Invoice ${invoiceId} not found in this tenant.`);
    this.name = "InvoiceNotFoundError";
  }
}

export class PaymentNotFoundError extends Error {
  constructor(public readonly paymentId: number) {
    super(`Payment ${paymentId} not found on this invoice in this tenant.`);
    this.name = "PaymentNotFoundError";
  }
}

export class OverpaymentError extends Error {
  constructor(
    public readonly outstanding: number,
    public readonly attempted: number,
  ) {
    super(
      `Payment of ${attempted} exceeds outstanding balance of ${outstanding}. ` +
        `Overpayments are not supported in v1 (design §1 #8).`,
    );
    this.name = "OverpaymentError";
  }
}

// ---------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------

/**
 * Derives the lifecycle status from amount_total + amount_paid + the
 * current status. Never changes 'written_off' — that's a terminal stage
 * set explicitly via PATCH /api/invoices/[id], not derived.
 *
 * Used inside recordPayment / deletePayment, and re-derived on
 * amount_total changes from the PATCH route.
 */
export function deriveStatus(
  amountTotal: number | string,
  amountPaid: number | string,
  currentStatus: InvoiceStatus,
): InvoiceStatus {
  if (currentStatus === "written_off") return "written_off";
  const total = Number(amountTotal);
  const paid = Number(amountPaid);
  // 1e-9 fuzz mirrors recordPayment's overpayment check: an exact-payoff
  // can drift to paid=$99.9999... in JS Number arithmetic even when pg
  // NUMERIC stored $100.00 cleanly. Without fuzz, the exact-payoff case
  // resolves 'partial' instead of 'paid' — invariant violated.
  if (paid <= 1e-9) return "open";
  if (paid >= total - 1e-9) return "paid";
  return "partial";
}

// ---------------------------------------------------------------------
// Transactional writes
// ---------------------------------------------------------------------

/**
 * Record a payment against an invoice. Transaction-wraps three writes:
 *   1. SELECT ... FOR UPDATE on the invoice row (locks it for the txn)
 *   2. INSERT INTO invoice_payments
 *   3. UPDATE invoices SET amount_paid += $amount, status = derive(...)
 *
 * Validates tenant ownership (WHERE client_id = $clientId on every read
 * + write). Rejects overpayment with OverpaymentError (design §1 #8).
 * Rolls back on any pg error and re-throws.
 *
 * Returns the updated invoice + the new payment row.
 */
export async function recordPayment(opts: {
  invoiceId: number;
  clientId: number;
  amount: number;
  paidAt: string; // YYYY-MM-DD
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
}): Promise<{ invoice: InvoiceRow; payment: InvoicePaymentRow }> {
  const { invoiceId, clientId, amount, paidAt } = opts;
  const method = opts.method ?? null;
  const reference = opts.reference ?? null;
  const notes = opts.notes ?? null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the invoice row for the duration of the transaction so a
    // parallel payment write can't race us into an inconsistent state.
    const invResult = await client.query<InvoiceRow>(
      "SELECT * FROM invoices WHERE id = $1 AND client_id = $2 FOR UPDATE",
      [invoiceId, clientId],
    );
    if (invResult.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new InvoiceNotFoundError(invoiceId);
    }
    const inv = invResult.rows[0];

    const outstanding = Number(inv.amount_total) - Number(inv.amount_paid);
    // Allow tiny float fuzz (1e-9) so a payment of exactly the
    // outstanding amount doesn't reject due to rounding noise.
    if (amount > outstanding + 1e-9) {
      await client.query("ROLLBACK");
      throw new OverpaymentError(outstanding, amount);
    }

    const paymentResult = await client.query<InvoicePaymentRow>(
      `INSERT INTO invoice_payments
         (invoice_id, client_id, amount, paid_at, method, reference, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [invoiceId, clientId, amount, paidAt, method, reference, notes],
    );

    const newAmountPaid = Number(inv.amount_paid) + amount;
    const newStatus = deriveStatus(inv.amount_total, newAmountPaid, inv.status);

    const updatedInvResult = await client.query<InvoiceRow>(
      `UPDATE invoices
          SET amount_paid = amount_paid + $1,
              status = $2,
              updated_at = NOW()
        WHERE id = $3 AND client_id = $4
        RETURNING *`,
      [amount, newStatus, invoiceId, clientId],
    );

    await client.query("COMMIT");
    return {
      invoice: updatedInvResult.rows[0],
      payment: paymentResult.rows[0],
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Delete a recorded payment. Transaction-wraps:
 *   1. SELECT ... FOR UPDATE on the invoice row
 *   2. SELECT the payment row (to get its amount + verify tenancy)
 *   3. DELETE the payment
 *   4. UPDATE invoices SET amount_paid -= $amount, status = derive(...)
 *
 * Used to back out a mis-entered payment. The UI MUST double-confirm
 * before calling this route.
 *
 * Returns the updated invoice.
 */
export async function deletePayment(opts: {
  invoiceId: number;
  clientId: number;
  paymentId: number;
}): Promise<{ invoice: InvoiceRow }> {
  const { invoiceId, clientId, paymentId } = opts;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const invResult = await client.query<InvoiceRow>(
      "SELECT * FROM invoices WHERE id = $1 AND client_id = $2 FOR UPDATE",
      [invoiceId, clientId],
    );
    if (invResult.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new InvoiceNotFoundError(invoiceId);
    }
    const inv = invResult.rows[0];

    const payResult = await client.query<InvoicePaymentRow>(
      `SELECT * FROM invoice_payments
         WHERE id = $1 AND invoice_id = $2 AND client_id = $3`,
      [paymentId, invoiceId, clientId],
    );
    if (payResult.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new PaymentNotFoundError(paymentId);
    }
    const payment = payResult.rows[0];

    await client.query(
      "DELETE FROM invoice_payments WHERE id = $1 AND client_id = $2",
      [paymentId, clientId],
    );

    const newAmountPaid = Number(inv.amount_paid) - Number(payment.amount);
    const newStatus = deriveStatus(inv.amount_total, newAmountPaid, inv.status);

    const updatedInvResult = await client.query<InvoiceRow>(
      `UPDATE invoices
          SET amount_paid = amount_paid - $1,
              status = $2,
              updated_at = NOW()
        WHERE id = $3 AND client_id = $4
        RETURNING *`,
      [payment.amount, newStatus, invoiceId, clientId],
    );

    await client.query("COMMIT");
    return { invoice: updatedInvResult.rows[0] };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// Phase 6.5 — Review-queue helpers
// ---------------------------------------------------------------------

/**
 * Clear the needs_review flag on an auto-detected invoice. Used by the
 * PATCH /api/invoices/[id]/review approve path. Tenant-scoped via
 * WHERE client_id = $2. Throws InvoiceNotFoundError when no matching
 * row exists (404 at the API layer).
 *
 * Idempotent — calling this on an already-approved row is a no-op
 * UPDATE that still returns the current row state.
 */
export async function approveInvoice(opts: {
  invoiceId: number;
  clientId: number;
}): Promise<{ invoice: InvoiceRow }> {
  const { invoiceId, clientId } = opts;
  const result = await pool.query<InvoiceRow>(
    `UPDATE invoices
        SET needs_review = false,
            updated_at = NOW()
      WHERE id = $1 AND client_id = $2
      RETURNING *`,
    [invoiceId, clientId],
  );
  if (result.rowCount === 0) {
    throw new InvoiceNotFoundError(invoiceId);
  }
  return { invoice: result.rows[0] };
}

/**
 * Hard-delete an auto-detected invoice the user dismissed as "not a real
 * invoice." Used by the PATCH /api/invoices/[id]/review dismiss path.
 *
 * Hard-delete (not soft-delete via status='written_off') is intentional
 * — auto-detected rows that aren't real invoices shouldn't pollute the
 * aging math or the audit trail. The user is saying "this is noise."
 * The unique index on (client_id, gmail_message_id) means a future
 * re-ingest of the same email WILL re-create the row, so the user can
 * recover from an accidental dismiss by clicking "Fetch from Gmail"
 * again.
 *
 * Refuses to dismiss invoices that aren't needs_review=true (a guard
 * against accidentally hard-deleting manually-entered or already-
 * approved rows via this endpoint). Manual rows are deleted via the
 * existing DELETE /api/invoices/[id] route.
 *
 * Throws InvoiceNotFoundError if no matching needs_review row exists.
 */
export async function dismissInvoice(opts: {
  invoiceId: number;
  clientId: number;
}): Promise<{ deletedId: number }> {
  const { invoiceId, clientId } = opts;
  const result = await pool.query<{ id: number }>(
    `DELETE FROM invoices
      WHERE id = $1
        AND client_id = $2
        AND needs_review = true
      RETURNING id`,
    [invoiceId, clientId],
  );
  if (result.rowCount === 0) {
    throw new InvoiceNotFoundError(invoiceId);
  }
  return { deletedId: result.rows[0].id };
}
