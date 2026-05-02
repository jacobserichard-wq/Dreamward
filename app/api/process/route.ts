import { NextRequest, NextResponse } from "next/server";
import { saveProcessedItem } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface EmailMessage {snippet: string;
  id: string;
  subject: string;
  from: string;
  date: string;
  body: string;
  labels: string[];
}

export async function POST(request: NextRequest) {
  try {
    const { emails, category } = await request.json();

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json(
        { error: "No emails provided" },
        { status: 400 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "API key not configured" },
        { status: 500 }
      );
    }

    const prompt = buildExtractionPrompt(emails, category);

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const responseText = message.content
      .filter((block) => block.type === "text")
      .map((block) => {
        if (block.type === "text") return block.text;
        return "";
      })
      .join("");

    try {
      const parsed = JSON.parse(
        responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
      );
      const results = Array.isArray(parsed) ? parsed : parsed.results || [];

      for (const result of results) {
        try {
          await saveProcessedItem({
            vendor: result.vendor || "Unknown",
            invoiceNumber: result.invoiceNumber || "N/A",
            amount: result.amount || 0,
            dueDate: result.dueDate || null,
            status: result.status || "needs_review",
            category: result.category || category || "invoice",
            confidence: result.confidence || 0,
            summary: result.summary || "",
            rawEmailId: result.rawEmailId || "",
            extractedData: result,
          });
        } catch (dbErr) { console.error("DB save error:", dbErr); }
      }

      return NextResponse.json({
        success: true,
        processed: results.length,
        results,
      });
    } catch (parseError) {
      console.error("Failed to parse Claude response:", responseText);
      return NextResponse.json({
        success: true,
        processed: emails.length,
        results: emails.map((email: EmailMessage) => ({
          id: Math.random().toString(36).substr(2, 9),
          vendor: email.from?.split("<")[0]?.trim() || "Unknown",
          invoiceNumber: "PARSE_ERROR",
          amount: 0,
          dueDate: "",
          status: "needs_review",
          category: category || "invoice",
          confidence: 0,
          rawEmailId: email.id,
          summary: `Could not auto-extract. Subject: ${email.subject}`,
        })),
      });
    }
  } catch (error: unknown) {
    console.error("Processing error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Processing failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}

function buildExtractionPrompt(
  emails: EmailMessage[],
  category: string
): string {
  const categoryInstructions: Record<string, string> = {
    invoice: `Extract invoice details: vendor name, invoice number, total amount (as a number), due date (YYYY-MM-DD format), and payment status.`,
    expense: `Extract expense details: vendor/merchant name, expense category, amount (as a number), date of expense (YYYY-MM-DD), and whether a receipt is attached.`,
    ar_followup: `Extract accounts receivable details: customer name, invoice number referenced, outstanding amount (as a number), original due date (YYYY-MM-DD), and days overdue.`,
  };

  const instruction =
    categoryInstructions[category] || categoryInstructions.invoice;

  return `You are an accounting automation assistant. Analyze the following emails and extract structured financial data.

${instruction}

For each email, determine a confidence score (0-100) for your extraction accuracy.
Set status to: "pending" if not yet due, "overdue" if past due, "paid" if payment confirmed, "needs_review" if unclear.

Respond with ONLY a JSON array (no markdown fences, no explanation) in this exact format:
[
  {
    "id": "<generate a unique id>",
    "vendor": "<vendor or customer name>",
    "invoiceNumber": "<invoice/reference number or N/A>",
    "amount": <number>,
    "dueDate": "<YYYY-MM-DD or empty string>",
    "status": "<pending|overdue|paid|needs_review>",
    "category": "${category}",
    "confidence": <0-100>,
    "rawEmailId": "<the email id provided>",
    "summary": "<one-sentence summary>"
  }
]

Here are the emails to process:

${emails
  .map(
    (email: EmailMessage, idx: number) => `
--- EMAIL ${idx + 1} ---
ID: ${email.id}
From: ${email.from}
Subject: ${email.subject}
Date: ${email.date}
Body:
${email.body?.substring(0, 2000) || email.snippet || "[empty body]"}
---`
  )
  .join("\n")}`;
}