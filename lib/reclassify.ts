import Anthropic from "@anthropic-ai/sdk";
import pool from "@/lib/db";
import {
  getCategoryNamesForIndustry,
  INDUSTRY_DISPLAY_NAMES,
  type Industry,
} from "@/lib/categories";

const DEFAULT_BATCH_LIMIT = 50;
const UMBRELLA_VALUES = ["invoice", "expense", "ar_followup"];
const AI_MODEL = "claude-sonnet-4-20250514";

interface TargetItem {
  id: number;
  vendor: string | null;
  amount: number | string;
  invoice_number: string | null;
  summary: string | null;
}

interface Mapping {
  id: number;
  category: string;
  confidence: number;
}

export type ReclassifyResult = {
  clientId: number;
  reclassified: number;
  remaining: number;
  total: number;
  error?: string;
};

export async function reclassifyClientItems(
  clientId: number,
  industry: Industry,
  options: { batchLimit?: number } = {}
): Promise<ReclassifyResult> {
  const batchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const allowedCategories = getCategoryNamesForIndustry(industry);
  const industryName =
    INDUSTRY_DISPLAY_NAMES[industry] ?? INDUSTRY_DISPLAY_NAMES.other;

  // Count umbrella items currently in scope (before batching) so the
  // response can report `remaining` accurately for the "click again to
  // continue" UX.
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM processed_items
     WHERE client_id = $1
       AND category = ANY($2)
       AND original_ai_category IS NULL`,
    [clientId, UMBRELLA_VALUES]
  );
  const totalBeforeReclassify = countResult.rows[0]?.n ?? 0;

  if (totalBeforeReclassify === 0) {
    return { clientId, reclassified: 0, remaining: 0, total: 0 };
  }

  // Pull the next batch of legacy umbrella items. ORDER BY processed_at DESC
  // is consistent with /api/items's existing ordering, so the user sees
  // their newest items get reclassified first (more relevant to them).
  const targetResult = await pool.query<TargetItem>(
    `SELECT id, vendor, amount, invoice_number, summary
     FROM processed_items
     WHERE client_id = $1
       AND category = ANY($2)
       AND original_ai_category IS NULL
     ORDER BY processed_at DESC
     LIMIT $3`,
    [clientId, UMBRELLA_VALUES, batchLimit]
  );
  const targets = targetResult.rows;

  const prompt = buildReclassifyPrompt(targets, industryName, allowedCategories);

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  const message = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");

  let mappings: Mapping[] = [];
  try {
    const parsed = JSON.parse(
      responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
    );
    mappings = Array.isArray(parsed) ? parsed : parsed.mappings || [];
  } catch {
    console.error("Reclassify: failed to parse AI response:", responseText);
    throw new Error("AI returned invalid data");
  }

  // Defensive validation: drop mappings whose category isn't in the
  // industry's allowed list, OR whose id isn't in the batch we sent.
  // (Mirrors the validation block in /api/process.) These rows stay
  // unchanged in the DB.
  const targetIds = new Set(targets.map((t) => t.id));
  const validMappings: Mapping[] = [];
  for (const m of mappings) {
    if (!m || typeof m.id !== "number" || !targetIds.has(m.id)) continue;
    if (!m.category || !allowedCategories.includes(m.category)) {
      console.warn(
        `Reclassify: AI returned invalid category "${m.category}" for id=${m.id}, industry="${industry}"; dropping.`
      );
      continue;
    }
    validMappings.push(m);
  }

  // Apply UPDATEs in a transaction. If anything mid-batch fails, none
  // commit — caller can retry with no partial-state to clean up.
  const dbClient = await pool.connect();
  let reclassified = 0;
  try {
    await dbClient.query("BEGIN");
    for (const m of validMappings) {
      // The extra WHERE conditions (category = ANY(...), original_ai_category
      // IS NULL) defend against the rare case where a row changed between
      // SELECT and UPDATE — e.g., user manually edited the category in
      // another tab, or a concurrent reclassify already ran.
      const updateResult = await dbClient.query(
        `UPDATE processed_items
         SET category = $1,
             confidence = $2,
             ai_classified_at = NOW(),
             ai_model = $3
         WHERE id = $4
           AND client_id = $5
           AND original_ai_category IS NULL
           AND category = ANY($6)`,
        [
          m.category,
          m.confidence ?? 0,
          AI_MODEL,
          m.id,
          clientId,
          UMBRELLA_VALUES,
        ]
      );
      if ((updateResult.rowCount ?? 0) > 0) reclassified++;
    }
    await dbClient.query("COMMIT");
  } catch (txErr) {
    await dbClient.query("ROLLBACK");
    console.error("Reclassify: transaction failed:", txErr);
    throw txErr;
  } finally {
    dbClient.release();
  }

  return {
    clientId,
    reclassified,
    remaining: Math.max(0, totalBeforeReclassify - reclassified),
    total: totalBeforeReclassify,
  };
}

function buildReclassifyPrompt(
  items: TargetItem[],
  industryName: string,
  allowedCategories: string[]
): string {
  const allowedList = allowedCategories.map((c) => `  - ${c}`).join("\n");
  return `You are an accounting automation assistant for a ${industryName} business. The following financial items were already extracted but only labeled with their umbrella type (invoice / expense / ar_followup). Reclassify each one into a specific category from the allowed list.

The category MUST be one of the values below VERBATIM. If no category fits perfectly, use the closest match — do not invent new category names or modify the spelling.

Allowed categories:
${allowedList}

For each item, also assign a confidence score (0-100) for the category fit.

Respond with ONLY a JSON array (no markdown fences, no explanation) in this exact format:
[
  { "id": <integer id>, "category": "<one of the allowed categories above, verbatim>", "confidence": <0-100> }
]

Here are the items to reclassify:

${items
  .map(
    (item) => `--- ITEM ${item.id} ---
Vendor: ${item.vendor ?? "Unknown"}
Amount: $${item.amount}
Invoice #: ${item.invoice_number ?? "N/A"}
Summary: ${item.summary ?? "N/A"}
---`
  )
  .join("\n")}`;
}
