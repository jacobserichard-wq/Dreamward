import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { getClientSettings } from "@/lib/db";
import {
  getCategoryNamesForIndustry,
  INDUSTRY_DISPLAY_NAMES,
  type Industry,
} from "@/lib/categories";

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

    const text = await file.text();
    const fileName = file.name.toLowerCase();

    let rows: string[][] = [];
    if (fileName.endsWith(".csv") || fileName.endsWith(".tsv")) {
      const delimiter = fileName.endsWith(".tsv") ? "\t" : ",";
      rows = parseCSV(text, delimiter);
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload a CSV file." },
        { status: 400 }
      );
    }

    if (rows.length < 2) {
      return NextResponse.json(
        { error: "File must have a header row and at least one data row." },
        { status: 400 }
      );
    }

    const headers = rows[0];
    const dataRows = rows.slice(1).filter((r) => r.some((cell) => cell.trim()));

    const settings = await getClientSettings(client.id);
    const customCategories: string[] = Array.isArray(settings?.custom_categories)
      ? settings.custom_categories
      : [];

    // Industry-aware defaults + customer additions, deduplicated.
    // Replaces the prior hardcoded fallback array (closes audit-ai-classification §3
    // gap for the CSV path; mirrors the Gmail-path approach in commit 11.2).
    const industry = (client.industry ?? "other") as Industry;
    const industryName = INDUSTRY_DISPLAY_NAMES[industry] ?? INDUSTRY_DISPLAY_NAMES.other;
    const defaults = getCategoryNamesForIndustry(industry);
    const allCategories = Array.from(new Set([...defaults, ...customCategories]));

    const allDataForClaude = dataRows.slice(0, 200);

    const prompt = `You are a bookkeeping data mapper for a ${industryName} business. Analyze this CSV data and:

1. Map the columns to these standard fields: vendor, invoice_number, amount, due_date, description
2. Categorize each row into one of these categories for a ${industryName} business. The category MUST be one of the values below VERBATIM. If no category fits perfectly, use the closest match — do not invent new category names or modify the spelling. Allowed categories: ${allCategories.join(", ")}

HEADERS: ${JSON.stringify(headers)}

ALL ROWS:
${allDataForClaude.map((r, i) => `Row ${i + 1}: ${JSON.stringify(r)}`).join("\n")}

Respond ONLY with valid JSON, no markdown, no backticks:
{
  "column_mapping": {
    "vendor": <column index or -1>,
    "invoice_number": <column index or -1>,
    "amount": <column index or -1>,
    "due_date": <column index or -1>,
    "description": <column index or -1>
  },
  "mapped_rows": [
    {
      "vendor": "extracted vendor name",
      "invoice_number": "extracted invoice number or null",
      "amount": 123.45,
      "due_date": "2024-01-15 or null",
      "description": "what this charge is for",
      "category": "one of the categories listed above",
      "confidence": 85
    }
  ]
}

Rules:
- amount should be a positive number (remove $ signs, commas, handle negatives as positive)
- due_date should be YYYY-MM-DD format or null
- confidence is 0-100 for how confident you are in the category assignment
- If a column doesn't map to any field, use -1
- Always try to extract a vendor name even if the column isn't obviously labeled

QuickBooks Export Detection:
- If headers include "Transaction Type", "Num", "Name", "Memo/Description", "Split", "Amount", "Balance" this is a QuickBooks Online export
- For QB exports: "Name" = vendor, "Num" = invoice_number, "Amount" = amount, "Date" = due_date, "Memo/Description" or "Memo" = description
- QB "Transaction Type" values like "Bill", "Expense", "Check", "Credit Card Charge" help determine the category
- QB exports may have "Split" column showing the GL account, use this to improve category accuracy
- Ignore rows where Transaction Type is "Transfer" or "Deposit" unless they look like vendor payments
- If QB "Amount" is negative, treat it as a positive expense amount

Other Accounting Software:
- Xero exports: "Date", "Description", "Reference", "Contact", "Debit Amount" or "Credit Amount"
- Wave exports: "Date", "Description", "Amount", "Account", "Name"
- Generic bookkeeping: look for any columns resembling date, vendor/payee/name, amount/total, description/memo, category/account/type`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      console.error("Claude API error:", err);
      return NextResponse.json(
        { error: "AI processing failed. Please try again." },
        { status: 500 }
      );
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    let parsed;
    try {
      parsed = JSON.parse(responseText.replace(/```json|```/g, "").trim());
    } catch {
      console.error("Failed to parse Claude response:", responseText);
      return NextResponse.json(
        { error: "AI returned invalid data. Please try again." },
        { status: 500 }
      );
    }

    // Defensively validate each row's category against the allowed list. The
    // CsvReviewModal will let the user pick from the dropdown for null rows;
    // mirrors the commit 11.2 validation pattern.
    const mappedRows = parsed.mapped_rows || [];
    for (const row of mappedRows) {
      if (row.category && !allCategories.includes(row.category)) {
        console.warn(
          `AI returned invalid category "${row.category}" for industry "${industry}"; dropping.`
        );
        row.category = null;
      }
    }

    return NextResponse.json({
      headers,
      totalRows: dataRows.length,
      columnMapping: parsed.column_mapping,
      mappedRows,
      categories: allCategories,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Upload processing failed" },
      { status: 500 }
    );
  }
}

function parseCSV(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        current.push(cell.trim());
        cell = "";
      } else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
        current.push(cell.trim());
        if (current.some((c) => c)) rows.push(current);
        current = [];
        cell = "";
        if (ch === "\r") i++;
      } else {
        cell += ch;
      }
    }
  }
  if (cell || current.length) {
    current.push(cell.trim());
    if (current.some((c) => c)) rows.push(current);
  }
  return rows;
}
