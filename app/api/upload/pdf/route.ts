// app/api/upload/pdf/route.ts
//
// PDF invoice/receipt upload. Unlike the tabular CSV/XLSX path
// (../route.ts), a PDF is a DOCUMENT — one vendor bill, not a grid of
// rows — so we send it to Claude as a native document content block and
// have it extract the invoice into the SAME mappedRows shape the CSV
// route returns. That lets the existing review modal + /api/upload/
// confirm flow handle it unchanged; only the extraction step differs.
//
// Claude reads PDFs natively (text + layout), so no separate OCR.

import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { getClientSettings } from "@/lib/db";
import pool from "@/lib/db";
import {
  getCategoryNamesForIndustry,
  INDUSTRY_DISPLAY_NAMES,
  type Industry,
} from "@/lib/categories";
import { isPayingTier } from "@/lib/plans";
import { AI_MODEL } from "@/lib/aiModel";

// Anthropic accepts PDFs up to ~32MB base64; guard well under that so a
// huge scan fails fast with a clear message instead of a timeout.
const MAX_PDF_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: "This endpoint only accepts PDF files." },
        { status: 400 }
      );
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "PDF is too large (max 10MB). Try exporting a smaller file." },
        { status: 400 }
      );
    }

    // Optional batch event id (same contract as the CSV route): verify
    // it belongs to this client before trusting it. Non-paying users
    // can't use Events, so their eventId is ignored.
    const eventsGated = !isPayingTier(client.plan);
    let batchEventId: number | null = null;
    const rawEventId = formData.get("eventId");
    if (!eventsGated && typeof rawEventId === "string" && rawEventId.trim() !== "") {
      const parsed = Number(rawEventId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
      }
      const verify = await pool.query<{ id: number }>(
        `SELECT id FROM events WHERE id = $1 AND client_id = $2`,
        [parsed, client.id]
      );
      if (verify.rowCount === 0) {
        return NextResponse.json({ error: "Event not found" }, { status: 400 });
      }
      batchEventId = parsed;
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    const settings = await getClientSettings(client.id);
    const customCategories: string[] = Array.isArray(settings?.custom_categories)
      ? settings.custom_categories
      : [];
    const industry = (client.industry ?? "other") as Industry;
    const industryName =
      INDUSTRY_DISPLAY_NAMES[industry] ?? INDUSTRY_DISPLAY_NAMES.other;
    const defaults = getCategoryNamesForIndustry(industry);
    const allCategories = Array.from(new Set([...defaults, ...customCategories]));

    const prompt = `You are a bookkeeping assistant for a ${industryName} business. The attached PDF is a vendor invoice, bill, or receipt. Extract its details.

Return ONE row per distinct invoice or charge in the document — usually just one (the invoice total). Do NOT split into individual line items; capture each invoice as a single transaction at its TOTAL amount.

Categorize each row into one of these categories for a ${industryName} business. The category MUST be one of the values below VERBATIM — use the closest match, never invent or re-spell. Allowed categories: ${allCategories.join(", ")}

Respond ONLY with valid JSON, no markdown, no backticks:
{
  "mapped_rows": [
    {
      "vendor": "the business that issued the invoice (the payee)",
      "invoice_number": "invoice or receipt number, or null",
      "amount": 123.45,
      "due_date": "YYYY-MM-DD (the invoice date, or the due date if no invoice date) or null",
      "description": "short summary of what was purchased",
      "category": "one of the categories above",
      "confidence": 85
    }
  ]
}

Rules:
- amount = the invoice TOTAL as a positive number (strip $ and commas)
- due_date = YYYY-MM-DD or null
- Always extract a vendor (the business that billed you)
- A receipt or bill you PAID is an expense — choose the matching expense category
- confidence is 0-100 for how sure you are of the category`;

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("Upload PDF: ANTHROPIC_API_KEY not configured");
      return NextResponse.json(
        {
          error:
            "AI isn't configured (missing ANTHROPIC_API_KEY). Set it in Vercel and redeploy.",
        },
        { status: 500 }
      );
    }

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      console.error(`Claude PDF API error (HTTP ${claudeRes.status}):`, err);
      const hint =
        claudeRes.status === 401
          ? "The Anthropic API key looks invalid."
          : claudeRes.status === 404
            ? "The configured AI model wasn't found for this account."
            : claudeRes.status === 413 || claudeRes.status === 400
              ? "The PDF couldn't be read — it may be too large or not a real PDF."
              : "Please try again.";
      return NextResponse.json(
        { error: `AI processing failed (HTTP ${claudeRes.status}). ${hint}` },
        { status: 500 }
      );
    }

    const claudeData = await claudeRes.json();
    const responseText = (claudeData.content || [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");

    let parsed: { mapped_rows?: unknown };
    try {
      parsed = JSON.parse(responseText.replace(/```json|```/g, "").trim());
    } catch {
      console.error("Failed to parse Claude PDF response:", responseText);
      return NextResponse.json(
        { error: "AI returned invalid data. Please try again." },
        { status: 500 }
      );
    }

    const mappedRows = Array.isArray(parsed.mapped_rows)
      ? (parsed.mapped_rows as Record<string, unknown>[])
      : [];
    if (mappedRows.length === 0) {
      return NextResponse.json(
        {
          error:
            "Couldn't find an invoice in that PDF. Make sure it's a vendor invoice or receipt.",
        },
        { status: 422 }
      );
    }

    // Defensively validate categories (same as the CSV route) + bind the
    // event id. PDF invoices aren't market-day sales, so we never date-
    // match to events — only honor an explicit batch event id.
    for (const row of mappedRows) {
      if (
        row.category &&
        typeof row.category === "string" &&
        !allCategories.includes(row.category)
      ) {
        console.warn(
          `AI returned invalid category "${row.category}" for industry "${industry}"; dropping.`
        );
        row.category = null;
      }
      row.event_id = batchEventId;
    }

    return NextResponse.json({
      totalRows: mappedRows.length,
      mappedRows,
      categories: allCategories,
      source: "pdf",
    });
  } catch (error) {
    console.error("PDF upload error:", error);
    return NextResponse.json(
      { error: "PDF processing failed" },
      { status: 500 }
    );
  }
}
