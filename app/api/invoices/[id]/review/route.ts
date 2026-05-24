// app/api/invoices/[id]/review/route.ts
//
// Phase 6.5 commit 5 of 8. PATCH /api/invoices/[id]/review — the
// review-queue action endpoint. Designed in phase-6.5-design.md §3.
//
// Body: { action: "approve" | "dismiss" }
//
// approve  → calls approveInvoice (clears needs_review on the row)
// dismiss  → calls dismissInvoice (hard-deletes the auto-detected
//            row; refuses to touch manual rows — see lib/invoices.ts
//            docstring for the rationale)
//
// Plan gate matches the rest of the /api/invoices/* surface
// (Growth+ with trial preview). Tenant scoping is enforced inside
// the lib helpers — every WHERE clause carries client_id.
//
// Next 16: route params come in as a Promise<{ id }> per
// AGENTS.md. The handler awaits the param.

import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import {
  approveInvoice,
  dismissInvoice,
  InvoiceNotFoundError,
} from "@/lib/invoices";

function isPlanAllowed(plan: string | null | undefined): boolean {
  return plan === "growth" || plan === "pro" || plan === "trial";
}

interface ReviewBody {
  action?: unknown;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const invoiceId = Number(id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      return NextResponse.json(
        { error: "Invalid invoice id" },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as ReviewBody;
    if (body.action !== "approve" && body.action !== "dismiss") {
      return NextResponse.json(
        { error: 'Body must be { action: "approve" | "dismiss" }' },
        { status: 400 }
      );
    }

    if (body.action === "approve") {
      const { invoice } = await approveInvoice({
        invoiceId,
        clientId: client.id,
      });
      return NextResponse.json({
        action: "approved",
        invoiceId: invoice.id,
        needsReview: invoice.needs_review,
      });
    }

    // body.action === "dismiss"
    const { deletedId } = await dismissInvoice({
      invoiceId,
      clientId: client.id,
    });
    return NextResponse.json({
      action: "dismissed",
      invoiceId: deletedId,
    });
  } catch (err) {
    if (err instanceof InvoiceNotFoundError) {
      return NextResponse.json(
        { error: err.message },
        { status: 404 }
      );
    }
    console.error("Invoice review error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Review failed" },
      { status: 500 }
    );
  }
}
