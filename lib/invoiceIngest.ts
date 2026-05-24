// lib/invoiceIngest.ts
//
// Phase 6.5 commit 2 of 8. Pure helpers for AR auto-detection from
// Gmail. Designed in session-notes/phase-6.5-design.md §3 + §4.
//
// Two responsibilities:
//
//   1. Keyword pre-filter (subjectLooksLikeInvoice) — cheap local
//      heuristic to avoid spending Anthropic tokens on every random
//      email in a label batch. Catches "Invoice INV-001", "Bill #42",
//      "Statement May 2026", etc. Lossy by design; the Claude pass
//      that follows is the real arbiter.
//
//   2. Claude extraction (extractInvoiceFromEmail) — runs surviving
//      emails through the AR-targeted prompt and parses the structured
//      response. Returns one ExtractedInvoice per input email; the
//      route handler filters by isInvoice + confidence threshold.
//
// No I/O. The route handler (app/api/invoices/ingest/route.ts)
// owns Gmail fetching + DB inserts + tenant scoping.

import Anthropic from "@anthropic-ai/sdk";

// Confidence threshold below which we discard the extraction even
// when isInvoice=true. Design §1 #4 — locked at 60 for v1. Lower
// values produce too many false positives; higher values drop
// real-but-ambiguous invoices the user would want to see in the
// review queue.
export const INVOICE_CONFIDENCE_THRESHOLD = 60;

// Words/patterns in the subject that gate a message into the Claude
// extraction pass. Generous on purpose — false positives cost an
// Anthropic call ($), false negatives cost a missed invoice (user
// trust). Case-insensitive matched.
const SUBJECT_KEYWORDS = [
  "invoice",
  "inv-",
  "inv#",
  "bill",
  "statement",
  "payment due",
  "balance due",
  "amount due",
  "past due",
  "receipt", // sometimes covers "your invoice receipt"
];

// Match dollar-amount-like fragments ("$1,234.56", "USD 500", "500.00")
// alongside the keywords — a subject like "Order #INV-001 - $250.00"
// is almost certainly an invoice even if "invoice" isn't spelled out.
const SUBJECT_AMOUNT = /\$\s*\d|\busd\b|\b\d{2,}\.\d{2}\b/i;

/**
 * Cheap local pre-filter. Returns true when the subject looks
 * invoice-like enough to spend a Claude token on. Run BEFORE the
 * Anthropic call; the survivors are extracted with Claude.
 */
export function subjectLooksLikeInvoice(subject: string): boolean {
  if (!subject) return false;
  const lower = subject.toLowerCase();
  for (const kw of SUBJECT_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  if (SUBJECT_AMOUNT.test(subject)) return true;
  return false;
}

// Shape returned by extractInvoiceFromEmail. Mirrors the schema in
// design §4 with isInvoice as the route handler's gate.
export interface ExtractedInvoice {
  rawEmailId: string;
  isInvoice: boolean;
  confidence: number;
  customer_name: string | null;
  customer_email: string | null;
  invoice_number: string | null;
  invoice_date: string | null; // YYYY-MM-DD
  due_date: string | null;     // YYYY-MM-DD
  amount_total: number | null;
  notes: string | null;
}

// Shape the route handler hands in. The Gmail fetcher already
// normalizes to this in app/api/invoices/ingest/route.ts.
export interface EmailMessageForExtraction {
  id: string;
  from: string;
  to: string; // joined recipients (To + Cc); empty string if unknown
  subject: string;
  date: string;
  body: string; // plain-text body (HTML stripped upstream)
}

/**
 * Run a batch of emails through Claude and return one extraction per
 * email (same length, same order). Throws on Anthropic API error so
 * the route handler can 500 with a clean message.
 *
 * The batch size is bounded by the caller; the prompt template scales
 * linearly with email count so very large batches risk hitting the
 * 4096 max_tokens response cap. The route handler chunks to ≤ 20
 * emails per call (design §3 commit 3).
 */
export async function extractInvoicesFromEmails(opts: {
  emails: EmailMessageForExtraction[];
  industryName: string;
  apiKey: string;
}): Promise<ExtractedInvoice[]> {
  const { emails, industryName, apiKey } = opts;
  if (emails.length === 0) return [];

  const anthropic = new Anthropic({ apiKey });

  const prompt = buildExtractionPrompt(emails, industryName);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");

  // Claude occasionally wraps JSON in markdown fences despite our
  // instructions; strip defensively (matches the /api/process pattern).
  const cleaned = text.replace(/```json\n?|```\n?/g, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Claude returned non-JSON invoice extraction: ${String(err).slice(0, 200)}`
    );
  }

  const arr = Array.isArray(parsed) ? parsed : [];
  // Normalize each row into ExtractedInvoice with strict typing. Any
  // missing/malformed field becomes null + low confidence, so the
  // threshold filter in the route handler drops bad rows cleanly.
  return arr.map((raw, idx) => normalizeExtraction(raw, emails[idx]?.id ?? ""));
}

function buildExtractionPrompt(
  emails: EmailMessageForExtraction[],
  industryName: string
): string {
  return `You are an invoice data extractor for a ${industryName} business owner. For each email below, determine whether it represents an invoice the user SENT to a customer (or that a customer is asking the user about). Extract the invoice details when present.

For each email, return EXACTLY ONE JSON object in the response array:

{
  "rawEmailId": "<the email id provided>",
  "isInvoice": <true | false>,
  "confidence": <0-100>,
  "customer_name": "<recipient name if user-sent; sender name if customer-sent; else null>",
  "customer_email": "<email address, else null>",
  "invoice_number": "<extracted invoice/order number, else null>",
  "invoice_date": "<YYYY-MM-DD or null>",
  "due_date": "<YYYY-MM-DD or null>",
  "amount_total": <number or null>,
  "notes": "<one-sentence summary, else null>"
}

Rules:
- isInvoice=true ONLY when the email body or subject CLEARLY references an invoice/bill the recipient owes or has paid. Receipts for personal purchases, shipping notifications, thank-you notes, sales-pitch emails, and general customer correspondence → isInvoice=false.
- If isInvoice=false, set every other field to null except rawEmailId, isInvoice, confidence.
- amount_total must be the TOTAL billed (sum of line items + tax + shipping), not a tax-only or shipping-only number.
- If multiple invoices appear in one email (e.g., a statement), extract only the most prominent one and cap confidence at 70.
- Dates must be YYYY-MM-DD with no time component. If only a partial date is present, return null rather than guessing.
- confidence is your overall confidence in the extraction (not just the isInvoice boolean) — a clear invoice with one unclear field should be 60-80, not 95.

Respond with ONLY a JSON array, one object per email, in the order given. No markdown fences, no prose, no trailing commentary.

Here are the emails to process:

${emails
  .map(
    (e, i) => `
--- EMAIL ${i + 1} ---
ID: ${e.id}
From: ${e.from}
To: ${e.to}
Subject: ${e.subject}
Date: ${e.date}
Body:
${e.body.slice(0, 4000)}`
  )
  .join("\n")}`;
}

// Strict per-field normalization. Returns a safe ExtractedInvoice even
// when the raw value is missing or wrong-typed.
function normalizeExtraction(raw: unknown, fallbackId: string): ExtractedInvoice {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    rawEmailId: typeof r.rawEmailId === "string" ? r.rawEmailId : fallbackId,
    isInvoice: r.isInvoice === true,
    confidence:
      typeof r.confidence === "number" && Number.isFinite(r.confidence)
        ? Math.max(0, Math.min(100, r.confidence))
        : 0,
    customer_name: nonEmptyString(r.customer_name),
    customer_email: nonEmptyString(r.customer_email),
    invoice_number: nonEmptyString(r.invoice_number),
    invoice_date: isoDateOrNull(r.invoice_date),
    due_date: isoDateOrNull(r.due_date),
    amount_total:
      typeof r.amount_total === "number" && Number.isFinite(r.amount_total)
        ? r.amount_total
        : null,
    notes: nonEmptyString(r.notes),
  };
}

function nonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// Strict YYYY-MM-DD validator. Anything else → null (rather than
// passing through a guess). Matches the pg DATE column expectations.
function isoDateOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  // Basic sanity — month 1-12, day 1-31. Don't enforce calendar validity
  // (Claude won't produce Feb 30 in practice; if it does, pg will reject).
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return m[0];
}
