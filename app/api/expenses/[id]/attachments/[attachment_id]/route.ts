// app/api/expenses/[id]/attachments/[attachment_id]/route.ts
//
// Phase 9.4 commit 3 of 5. DELETE endpoint for a single
// attachment on an expense. Cleans up the Vercel Blob storage
// BEFORE removing the DB row so a failed cleanup leaves an
// auditable row pointing at the now-orphaned bytes (recoverable)
// rather than a deleted row + paid-for storage we can't find.
//
// DELETE /api/expenses/[id]/attachments/[attachment_id]
//   Returns: { deleted: true }
//
// Tenant scope: the attachment must belong to an expense that
// belongs to this client. Forged ids return 404. The JOIN-style
// check covers both layers in one query.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { deleteAttachment } from "@/lib/blob";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; attachment_id: string }> }
) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const { id: idParam, attachment_id: attachmentIdParam } = await params;
    const expenseId = Number(idParam);
    const attachmentId = Number(attachmentIdParam);
    if (!Number.isInteger(expenseId) || expenseId <= 0) {
      return NextResponse.json({ error: "Invalid expense id" }, { status: 400 });
    }
    if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
      return NextResponse.json(
        { error: "Invalid attachment id" },
        { status: 400 }
      );
    }

    // Look up the attachment's Blob pathname AND verify ownership
    // in one query. JOIN to processed_items.client_id is the
    // tenant gate.
    const lookup = await pool.query<{ blob_pathname: string }>(
      `SELECT ea.blob_pathname
         FROM expense_attachments ea
         JOIN processed_items pi ON pi.id = ea.processed_item_id
        WHERE ea.id = $1
          AND ea.processed_item_id = $2
          AND pi.client_id = $3`,
      [attachmentId, expenseId, client.id]
    );

    if (lookup.rowCount === 0) {
      return NextResponse.json(
        { error: "Attachment not found" },
        { status: 404 }
      );
    }

    const pathname = lookup.rows[0].blob_pathname;

    // Delete from Vercel Blob FIRST. If this throws we surface
    // a 500 and the DB row remains — preferable to silent
    // storage leak.
    await deleteAttachment(pathname);

    // Then remove the DB row. Repeat the tenant filter as
    // defense-in-depth; matches the existing /api/expenses
    // pattern.
    const del = await pool.query(
      `DELETE FROM expense_attachments
        WHERE id = $1
          AND processed_item_id = $2`,
      [attachmentId, expenseId]
    );

    if (del.rowCount === 0) {
      // Race condition — row removed between the lookup and
      // delete. Blob is already gone so the user-visible state
      // is correct; surface success anyway.
      return NextResponse.json({ deleted: true, alreadyGone: true });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("Attachment DELETE error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to delete attachment",
      },
      { status: 500 }
    );
  }
}
