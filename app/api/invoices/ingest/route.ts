// app/api/invoices/ingest/route.ts
//
// Phase 6.5 commit 3 of 8. POST /api/invoices/ingest — the AR
// auto-detect endpoint. Designed in session-notes/phase-6.5-design.md
// §3.
//
// Flow:
//   1. Auth + plan-gate (Growth+; matches /api/invoices route)
//   2. Validate body { label, after?, maxResults? }
//   3. Fetch Gmail messages for the label, with full body (`format:"full"`)
//   4. Pre-filter subjects via subjectLooksLikeInvoice
//   5. Run survivors through Claude via extractInvoicesFromEmails
//      (chunked at 20 emails / call to keep response token usage bounded)
//   6. Filter by isInvoice + confidence >= INVOICE_CONFIDENCE_THRESHOLD
//   7. Bulk-INSERT survivors as needs_review=true rows with
//      source='email-auto'; dedup via the unique partial index on
//      (client_id, gmail_message_id) — duplicate inserts are caught
//      and counted as skipped without failing the request.
//
// Returns: { inserted, skipped, errors, prefiltered, fetched }

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google, gmail_v1 } from "googleapis";
import pool from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { getSessionClient } from "@/lib/getClient";
import { INDUSTRY_DISPLAY_NAMES, type Industry } from "@/lib/categories";
import {
  subjectLooksLikeInvoice,
  extractInvoicesFromEmails,
  INVOICE_CONFIDENCE_THRESHOLD,
  type EmailMessageForExtraction,
} from "@/lib/invoiceIngest";
import { isPayingTier } from "@/lib/plans";

// Plan gate — mirrors /api/invoices (Growth+ with trial preview).
function isPlanAllowed(plan: string | null | undefined): boolean {
  return isPayingTier(plan);
}

// Cap on Anthropic batch size. The extraction prompt scales linearly
// per email body (each capped at 4000 chars in lib/invoiceIngest.ts);
// 20 emails × ~4KB = ~80KB input, well under the 200K context but
// generates response tokens that can exceed 4096 if too many emails
// each have full extractions. 20 is the conservative sweet spot.
const EXTRACTION_BATCH_SIZE = 20;

// Cap on Gmail fetch — design §5 default 50, hard max 100 (matches
// the existing /api/gmail route). Prevents a single user click from
// kicking off a 1000-email Claude run.
const MAX_FETCH = 100;

interface IngestBody {
  label?: unknown;
  after?: unknown;
  maxResults?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    // Authentication: NextAuth session for the OAuth accessToken (Gmail
    // API needs it), plus our own tenant lookup for client_id.
    const session = await getServerSession(authOptions);
    const accessToken = (session as unknown as { accessToken?: string })
      ?.accessToken;
    if (!accessToken) {
      return NextResponse.json(
        { error: "Not authenticated (Gmail access required)" },
        { status: 401 }
      );
    }
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPlanAllowed(client.plan)) {
      return NextResponse.json(
        { error: "AR auto-detect is a Growth or Pro feature" },
        { status: 403 }
      );
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as IngestBody;
    const label =
      typeof body.label === "string" && body.label.trim() !== ""
        ? body.label.trim()
        : "SENT";
    const after = typeof body.after === "string" ? body.after.trim() : "";
    const maxResults = Math.max(
      1,
      Math.min(
        MAX_FETCH,
        typeof body.maxResults === "number" && Number.isInteger(body.maxResults)
          ? body.maxResults
          : 50
      )
    );

    // ---- Step 3: fetch Gmail messages with full body ----
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: "v1", auth });

    // Resolve the label to its id. Gmail's system labels (SENT, INBOX)
    // resolve by name; user labels too. Comparison is case-insensitive
    // to be friendly to UI input.
    const labelsRes = await gmail.users.labels.list({ userId: "me" });
    const targetLabel = labelsRes.data.labels?.find(
      (l) => l.name?.toLowerCase() === label.toLowerCase()
    );
    if (!targetLabel || !targetLabel.id) {
      return NextResponse.json(
        { error: `Gmail label "${label}" not found` },
        { status: 404 }
      );
    }

    const listRes = await gmail.users.messages.list({
      userId: "me",
      labelIds: [targetLabel.id],
      maxResults,
      q: after ? `after:${after}` : undefined,
    });
    const messageIds = listRes.data.messages ?? [];

    if (messageIds.length === 0) {
      return NextResponse.json({
        fetched: 0,
        prefiltered: 0,
        inserted: 0,
        skipped: 0,
        errors: 0,
      });
    }

    // Pull bodies in parallel — `format: "full"` returns headers +
    // parts + bodies. Per-call cost is one Gmail API hit per message.
    const fullMessages = await Promise.all(
      messageIds.map((m) =>
        gmail.users.messages
          .get({ userId: "me", id: m.id!, format: "full" })
          .then((r) => r.data)
          .catch(() => null)
      )
    );

    // Convert each Gmail message into the extraction shape, with a
    // best-effort plain-text body extraction. messages.get sometimes
    // returns nested multipart trees; gmailMessageToEmail walks them.
    const emailsForExtraction: EmailMessageForExtraction[] = [];
    for (const m of fullMessages) {
      if (!m || !m.id) continue;
      const flat = gmailMessageToEmail(m);
      if (!flat) continue;
      if (!subjectLooksLikeInvoice(flat.subject)) continue;
      emailsForExtraction.push(flat);
    }

    const prefiltered = emailsForExtraction.length;

    if (prefiltered === 0) {
      return NextResponse.json({
        fetched: messageIds.length,
        prefiltered: 0,
        inserted: 0,
        skipped: 0,
        errors: 0,
      });
    }

    // ---- Step 5: Claude extraction in chunks ----
    const industry = (client.industry ?? "other") as Industry;
    const industryName =
      INDUSTRY_DISPLAY_NAMES[industry] ?? INDUSTRY_DISPLAY_NAMES.other;

    const allExtractions: Awaited<
      ReturnType<typeof extractInvoicesFromEmails>
    > = [];
    let extractionErrors = 0;
    for (let i = 0; i < emailsForExtraction.length; i += EXTRACTION_BATCH_SIZE) {
      const chunk = emailsForExtraction.slice(i, i + EXTRACTION_BATCH_SIZE);
      try {
        const out = await extractInvoicesFromEmails({
          emails: chunk,
          industryName,
          apiKey: process.env.ANTHROPIC_API_KEY,
        });
        allExtractions.push(...out);
      } catch (err) {
        console.error("Invoice extraction batch failed:", err);
        extractionErrors += chunk.length;
      }
    }

    // ---- Step 6: confidence filter ----
    const candidates = allExtractions.filter(
      (e) => e.isInvoice && e.confidence >= INVOICE_CONFIDENCE_THRESHOLD
    );

    // ---- Step 7: bulk-INSERT with dedup ----
    // We INSERT one row at a time inside a loop (not a single multi-row
    // INSERT) so each row's unique-violation can be caught individually
    // without rolling back peers. The volume is bounded (≤ MAX_FETCH)
    // and these are user-triggered, so the per-row overhead is fine.
    let inserted = 0;
    let skipped = 0;
    let dbErrors = 0;
    for (const c of candidates) {
      // Require the bare minimum to land a row: a customer name, an
      // amount, AND a due date. Without all three, the row is too thin
      // to be useful in the AR aging view — skip with a counter bump
      // and let the user re-fetch with a different label or enter
      // manually. (This is the design's "imperfect extraction" gate.)
      if (
        !c.customer_name ||
        c.amount_total === null ||
        c.amount_total === undefined ||
        !c.due_date
      ) {
        skipped += 1;
        continue;
      }
      // invoice_date is required by the schema. Fall back to today if
      // Claude couldn't extract it — the user can correct on review.
      const invoiceDate =
        c.invoice_date ??
        new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
      try {
        const ins = await pool.query<{ id: number }>(
          `INSERT INTO invoices (
             client_id, customer_name, customer_email, invoice_number,
             invoice_date, due_date, amount_total, amount_paid, status,
             notes, source, gmail_message_id, needs_review
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, 0, 'open',
             $8, 'email-auto', $9, true
           )
           ON CONFLICT (client_id, gmail_message_id) WHERE gmail_message_id IS NOT NULL
           DO NOTHING
           RETURNING id`,
          [
            client.id,
            c.customer_name,
            c.customer_email,
            c.invoice_number,
            invoiceDate,
            c.due_date,
            c.amount_total,
            c.notes,
            c.rawEmailId,
          ]
        );
        if (ins.rowCount === 0) {
          // ON CONFLICT DO NOTHING → row already existed, idempotent skip.
          skipped += 1;
        } else {
          inserted += 1;
        }
      } catch (err) {
        console.error("Invoice ingest INSERT failed:", err);
        dbErrors += 1;
      }
    }

    return NextResponse.json({
      fetched: messageIds.length,
      prefiltered,
      inserted,
      skipped,
      errors: extractionErrors + dbErrors,
    });
  } catch (err) {
    console.error("Invoice ingest error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Ingest failed",
      },
      { status: 500 }
    );
  }
}

// --- Gmail body extraction --------------------------------------------------

// Walk the message payload to extract a plain-text body and the From/To/
// Subject/Date headers. Gmail messages are nested multipart trees; we
// prefer text/plain parts, fall back to text/html with tags stripped.
function gmailMessageToEmail(
  msg: gmail_v1.Schema$Message
): EmailMessageForExtraction | null {
  if (!msg.id) return null;
  const headers = msg.payload?.headers ?? [];
  const getHeader = (name: string): string => {
    const h = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
    return h?.value ?? "";
  };
  const from = getHeader("From");
  const subject = getHeader("Subject");
  const date = getHeader("Date");
  // Join To + Cc (Bcc isn't on the user's own SENT messages in metadata).
  const to = [getHeader("To"), getHeader("Cc")].filter(Boolean).join(", ");

  const body = extractBody(msg.payload);
  return { id: msg.id, from, to, subject, date, body };
}

function extractBody(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return "";
  // Prefer text/plain — clean and small.
  const plain = findPart(part, "text/plain");
  if (plain) {
    const decoded = decodeBase64Url(plain.body?.data ?? "");
    if (decoded) return decoded;
  }
  // Fall back to text/html, strip tags + collapse whitespace.
  const html = findPart(part, "text/html");
  if (html) {
    const decoded = decodeBase64Url(html.body?.data ?? "");
    if (decoded) return stripHtml(decoded);
  }
  return "";
}

function findPart(
  part: gmail_v1.Schema$MessagePart,
  mimeType: string
): gmail_v1.Schema$MessagePart | null {
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const hit = findPart(child, mimeType);
    if (hit) return hit;
  }
  return null;
}

function decodeBase64Url(s: string): string {
  if (!s) return "";
  try {
    // Gmail uses URL-safe base64 (- for +, _ for /). Buffer.from accepts
    // it directly via the 'base64url' encoding.
    return Buffer.from(s, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
