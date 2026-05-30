// app/api/expenses/[id]/attachments/route.ts
//
// Phase 9.4 commit 2 of 5. POST (upload) + GET (list) endpoints
// for receipt attachments on a specific expense.
//
// POST /api/expenses/[id]/attachments
//   Body: multipart/form-data with a `file` field (single file
//   per request). The ExpenseForm UI multiplexes multi-file
//   selection into N parallel POSTs so this stays a simple
//   single-file path.
//
//   Returns: { attachment: AttachmentRow }
//
// GET /api/expenses/[id]/attachments
//   Returns: { attachments: AttachmentRow[] }
//
// Plan gating per locked design decision (sub-session 25):
//   - Trial: 10-attachment LIFETIME cap counted client-wide
//   - Starter / Growth / Pro: unlimited
//
// Per-file constraints:
//   - 10 MB hard cap
//   - MIME allowlist: image/jpeg, image/png, image/heic,
//     image/heif, image/webp, application/pdf
//
// Tenant scope: every query verifies the parent expense belongs
// to this client. Forged ids return 404.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { uploadAttachment } from "@/lib/blob";

const TRIAL_ATTACHMENT_CAP = 10;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg", // some clients send this even though it's not strictly correct
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "application/pdf",
]);

interface AttachmentRowDb {
  id: number;
  processed_item_id: number;
  filename: string;
  mime_type: string;
  size_bytes: number;
  blob_url: string;
  uploaded_at: string;
}

function serializeAttachment(row: AttachmentRowDb) {
  return {
    id: row.id,
    processedItemId: row.processed_item_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    blobUrl: row.blob_url,
    uploadedAt: row.uploaded_at,
  };
}

// ---------------------------------------------------------------------
// GET — list attachments for the expense
// ---------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const { id: idParam } = await params;
    const expenseId = Number(idParam);
    if (!Number.isInteger(expenseId) || expenseId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    // Tenant ownership: confirm the expense belongs to this client
    // before exposing its attachments. The JOIN-style check returns
    // an empty result when the expense exists but belongs elsewhere.
    const res = await pool.query<AttachmentRowDb>(
      `SELECT ea.id, ea.processed_item_id, ea.filename, ea.mime_type,
              ea.size_bytes, ea.blob_url, ea.uploaded_at
         FROM expense_attachments ea
         JOIN processed_items pi ON pi.id = ea.processed_item_id
        WHERE ea.processed_item_id = $1
          AND pi.client_id = $2
        ORDER BY ea.uploaded_at ASC, ea.id ASC`,
      [expenseId, client.id]
    );

    return NextResponse.json({
      attachments: res.rows.map(serializeAttachment),
    });
  } catch (err) {
    console.error("Attachments GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list attachments" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------
// POST — upload a single attachment
// ---------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const { id: idParam } = await params;
    const expenseId = Number(idParam);
    if (!Number.isInteger(expenseId) || expenseId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    // Verify the expense exists + belongs to this client. Done
    // BEFORE reading the multipart body so we fail fast on tenant
    // mismatch without burning request bandwidth.
    const ownership = await pool.query<{ id: number }>(
      `SELECT id FROM processed_items
        WHERE id = $1 AND client_id = $2`,
      [expenseId, client.id]
    );
    if (ownership.rowCount === 0) {
      return NextResponse.json(
        { error: "Expense not found" },
        { status: 404 }
      );
    }

    // ── Plan-gate: Trial 10-attachment lifetime cap ────────────
    // Counted client-wide (not per-expense) so the user can't
    // distribute 100 attachments across 10 expenses to bypass.
    if (client.plan === "trial") {
      const countRes = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM expense_attachments
          WHERE client_id = $1`,
        [client.id]
      );
      const used = countRes.rows[0]?.n ?? 0;
      if (used >= TRIAL_ATTACHMENT_CAP) {
        return NextResponse.json(
          {
            error: `Trial plans are limited to ${TRIAL_ATTACHMENT_CAP} attachments. Upgrade to add more.`,
            limitReached: true,
            used,
            cap: TRIAL_ATTACHMENT_CAP,
          },
          { status: 403 }
        );
      }
    }

    // ── Parse the multipart body + extract the file ────────────
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Invalid multipart/form-data body" },
        { status: 400 }
      );
    }
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file uploaded (expected `file` field)" },
        { status: 400 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        { error: "File is empty" },
        { status: 400 }
      );
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Limit is ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
        },
        { status: 413 }
      );
    }

    // Browsers occasionally send "application/octet-stream" for
    // unknown types or "" for files dragged from outside the OS
    // file picker. Both fail the allowlist — surface a friendly
    // error instead of a cryptic 500 from Blob.
    const mimeType =
      file.type && file.type.trim().length > 0
        ? file.type.trim().toLowerCase()
        : "";
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        {
          error: `Unsupported file type "${mimeType || "unknown"}". Allowed: JPEG, PNG, HEIC, WebP, PDF.`,
        },
        { status: 415 }
      );
    }

    // Filename sanity. Browsers usually set a sensible name; some
    // mobile uploads come through as "image" with no extension.
    // Don't reject — just accept and keep the OS name.
    const filename =
      file.name && file.name.trim().length > 0
        ? file.name.trim().slice(0, 200)
        : "receipt";

    // ── Upload to Vercel Blob ──────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const uploaded = await uploadAttachment({
      clientId: client.id,
      processedItemId: expenseId,
      filename,
      contentType: mimeType,
      body: Buffer.from(arrayBuffer),
    });

    // ── Persist row ────────────────────────────────────────────
    const insertRes = await pool.query<AttachmentRowDb>(
      `INSERT INTO expense_attachments
         (processed_item_id, client_id, filename, mime_type,
          size_bytes, blob_url, blob_pathname)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, processed_item_id, filename, mime_type,
                 size_bytes, blob_url, uploaded_at`,
      [
        expenseId,
        client.id,
        filename,
        mimeType,
        file.size,
        uploaded.url,
        uploaded.pathname,
      ]
    );

    return NextResponse.json({
      attachment: serializeAttachment(insertRes.rows[0]),
    });
  } catch (err) {
    console.error("Attachments POST error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to upload attachment",
      },
      { status: 500 }
    );
  }
}
