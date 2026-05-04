import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { getClientSettings } from "@/lib/db";

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

    // Parse CSV (Excel .csv exports work here too)
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

    // Get client's custom categories if any
    const settings = await getClientSettings(client.id);
    const customCategories: string[] = settings?.expense_categories
      ? JSON.parse(settings.expense_categories)
      : [];
    const defaultCategories = [
      "invoice", "expense", "ar_followup",
      "Office Supplies", "Travel", "Software", "Utilities",
      "Professional Services", "Insurance", "Payroll",
    ];
    const allCategories = customCategories.length > 0
      ? customCategories
      : defaultCategories;

    // Send headers + sample rows to Claude for mapping + categorization
    const sampleRows = dataRows.slice(0, 5);
    const allDataForClaude = dataRows.slice(0, 200); // limit to 200 rows

    const prompt = `You are a bookkeeping data mapper. Analyze this CSV data and:

1. Map the columns to these standard fields: vendor, invoice_number, amount, due_date, description
2. Categorize each row into one of these categories: ${allCategories.join(", ")}

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
- If headers include "Transaction Type", "Num", "Name", "Memo/Description", "Split", "Amount", "Balance" — this is a QuickBooks Online export
- For QB exports: "Name" = vendor, "Num" = invoice_number, "Amount" = amount, "Date" = due_date, "Memo/Description" or "Memo" = description
- QB "Transaction Type" values like "Bill", "Expense", "Check", "Credit Card Charge" help determine the category
- QB exports may have "Split" column showing the GL account — use this to improve category accuracy (e.g. "Office Supplies" split = Office Supplies category)
- Ignore rows where Transaction Type is "Transfer" or "Deposit" unless they look like vendor payments
- If QB "Amount" is negative, treat it as a positive expense amount

Other Accounting Software:
- Xero exports: "Date", "Description", "Reference", "Contact", "Debit Amount" / "Credit Amount"
- Wave exports: "Date", "Description", "Amount", "Account", "Name"
- Generic bookkeeping: look for any columns resembling date, vendor/payee/name, amount/total, description/memo, category/account/type`;