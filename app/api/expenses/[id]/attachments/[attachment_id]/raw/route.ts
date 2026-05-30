// app/api/expenses/[id]/attachments/[attachment_id]/raw/route.ts
//
// Phase 9.4 commit 5 of 5. Proxy endpoint that streams the raw
// bytes of an attachment to the authenticated merchant. Used by
// <img src> + <embed src> + the "Download" link in the
// AttachmentViewer modal.
//
// Why a proxy instead of using the Blob URL directly:
//   Vercel Blob's behavior around "Private" stores + access:
//   'public' uploads varies by API version. To keep auth
//   bulletproof regardless of those defaults, we always proxy
//   through our own session-authed route. The route validates
//   tenant ownership before fetching the bytes from Blob, then
//   pipes them back with the original Content-Type. A leaked
//   Blob URL alone never exposes a receipt to randos.
//
// GET /api/expenses/[id]/attachments/[attachment_id]/raw
//   Returns: image/pdf bytes with the recorded Content-Type +
//   inline Content-Disposition so browsers preview rather than
//   force-download.
//
// Tenant scope: JOIN through processed_items.client_id verifies
// the attachment belongs to the calling client.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";

export async function GET(
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

    const lookup = await pool.query<{
      blob_url: string;
      mime_type: string;
      filename: string;
    }>(
      `SELECT ea.blob_url, ea.mime_type, ea.filename
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

    const { blob_url, mime_type, filename } = lookup.rows[0];

    // Fetch the bytes from Vercel Blob. The token is sent in
    // case the store is configured as Private at the read level.
    // Public-shape URLs ignore the header; Private-shape URLs
    // require it. Either way works.
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const upstream = await fetch(blob_url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        {
          error: `Blob fetch failed: HTTP ${upstream.status}`,
        },
        { status: 502 }
      );
    }

    // Build the response. Stream the upstream body directly so
    // large files don't get fully buffered into RAM.
    const headers = new Headers();
    headers.set("Content-Type", mime_type);
    headers.set(
      "Content-Disposition",
      `inline; filename="${filename.replace(/"/g, "")}"`
    );
    // Don't cache aggressively — a deleted+re-created attachment
    // at the same id would serve stale bytes. Short cache is
    // fine; same-session navigation benefits.
    headers.set("Cache-Control", "private, max-age=60");
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(upstream.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error("Attachment raw GET error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to load attachment",
      },
      { status: 500 }
    );
  }
}
