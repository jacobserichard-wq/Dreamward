import { Pool, types } from "pg";

// Phase 5 follow-up bug fix: by default pg parses Postgres DATE (OID
// 1082) into a JavaScript Date object using server-local midnight,
// which JSON.stringify then serializes as a full ISO timestamp like
// "2026-05-19T05:00:00.000Z" (offset from midnight by the server tz).
// The event detail page's `<input type="date">` rejects that format
// outright and renders blank, wiping the date on every save round-
// trip; the profitability dashboard's monthly trend keys off slice(0,7)
// which can shift to the wrong month with tz drift; market tables show
// the ugly timestamp string directly to the user.
//
// Override the DATE parser to pass values through unchanged — pg hands
// us the raw "YYYY-MM-DD" string from the wire. Latent since
// sub-session 16 (Phase 3 commit 1 introduced the events tables); only
// just surfaced because the round-trip-save flow wasn't being exercised
// thoroughly before Phase 5 work added the dashboard derivations.
//
// TIMESTAMPTZ (OID 1184) stays on the default parser — downstream code
// wraps timestamp values in `new Date(...)` which handles both Date
// objects and ISO strings, so there's no comparable break and no need
// to touch it.
types.setTypeParser(1082, (val) => val);

// Pool sizing for serverless on a connection-limited managed Postgres.
// Vercel runs each route as its own (often warm) instance, and every
// instance opens its OWN pool — so an untuned default (max: 10, no idle
// release) lets warm instances accumulate connections until the DB's
// max_connections ceiling is hit and new requests get "too many clients
// already". Cap each instance small, release idle connections quickly,
// and fail fast rather than hanging when the pool is momentarily full.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

// --- Client Management ---

export async function getOrCreateClient(email: string) {
  // Fast path: existing client (a read, on every authenticated request).
  const existing = await pool.query(
    "SELECT * FROM clients WHERE email = $1",
    [email]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // First login → create. The app's first page load fires many requests at
  // once, so two can both miss the SELECT and race the INSERT; the email
  // UNIQUE would make the second throw. ON CONFLICT makes it idempotent —
  // both end up returning the same row. We also stamp plan + trial_ends_at
  // explicitly rather than trusting an (un-versioned) DB column default, so
  // the app owns its own trial invariant (no silent fallback).
  const result = await pool.query(
    `INSERT INTO clients (email, plan, trial_ends_at)
     VALUES ($1, 'trial', NOW() + INTERVAL '14 days')
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING *`,
    [email]
  );
  await pool.query(
    `INSERT INTO client_settings (client_id) VALUES ($1)
     ON CONFLICT (client_id) DO NOTHING`,
    [result.rows[0].id]
  );
  return result.rows[0];
}

export async function getClientByEmail(email: string) {
  const result = await pool.query(
    "SELECT * FROM clients WHERE email = $1",
    [email]
  );
  return result.rows[0] || null;
}

export async function updateClient(clientId: number, updates: any) {
  const fields: string[] = [];
  const vals: any[] = [];
  let i = 1;
  if (updates.business_name !== undefined) {
    fields.push("business_name = $" + i);
    vals.push(updates.business_name);
    i++;
  }
  if (updates.industry !== undefined) {
    fields.push("industry = $" + i);
    vals.push(updates.industry);
    i++;
  }
  if (updates.plan !== undefined) {
    fields.push("plan = $" + i);
    vals.push(updates.plan);
    i++;
  }
  if (updates.stripe_customer_id !== undefined) {
    fields.push("stripe_customer_id = $" + i);
    vals.push(updates.stripe_customer_id);
    i++;
  }
  if (updates.stripe_subscription_id !== undefined) {
    fields.push("stripe_subscription_id = $" + i);
    vals.push(updates.stripe_subscription_id);
    i++;
  }
  if (fields.length === 0) return null;
  fields.push("updated_at = NOW()");
  vals.push(clientId);
  return pool.query(
    "UPDATE clients SET " + fields.join(", ") +
    " WHERE id = $" + i + " RETURNING *",
    vals
  );
}

export async function getClientSettings(clientId: number) {
  const result = await pool.query(
    "SELECT * FROM client_settings WHERE client_id = $1",
    [clientId]
  );
  return result.rows[0] || null;
}

// --- Processed Items (scoped by client_id) ---

export async function saveProcessedItem(item: any, clientId: number) {
  const emailId = item.raw_email_id || item.rawEmailId || null;
  if (emailId) {
    const existing = await pool.query(
      "SELECT id FROM processed_items WHERE raw_email_id = $1 AND client_id = $2",
      [emailId, clientId]
    );
    if (existing.rows.length > 0) {
      return existing;
    }
  }
  const sql =
    "INSERT INTO processed_items " +
    "(vendor, invoice_number, amount, due_date, " +
    "status, category, confidence, summary, " +
    "raw_email_id, extracted_data, client_id, source, " +
    "ai_classified_at, ai_model, original_ai_category, event_id, channel) " +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) " +
    "RETURNING *";
  const vals = [
    item.vendor || "Unknown",
    item.invoice_number || item.invoiceNumber || null,
    item.amount || 0,
    item.due_date || item.dueDate || null,
    item.status || "needs_review",
    item.category || "invoice",
    item.confidence || 0,
    item.summary || null,
    emailId,
    (item.extracted_data || item.extractedData)
      ? JSON.stringify(item.extracted_data || item.extractedData)
      : null,
    clientId,
    item.source || "email",
    item.ai_classified_at || item.aiClassifiedAt || null,
    item.ai_model || item.aiModel || null,
    item.original_ai_category || item.originalAiCategory || null,
    item.event_id || item.eventId || null,
    // Sub-session 32 polish: persist the channel column on insert so
    // the Processed-tab card UI matches what the Dashboard rollup
    // already computes via classifyIncomeRow. Caller (e.g.
    // /api/upload/confirm) is expected to pre-derive via
    // deriveStorageChannel(). null when genuinely undeterminable —
    // the classifier's catch-all still puts those in "uploads" at
    // rollup time without polluting the persisted column.
    item.channel || null,
  ];
  return pool.query(sql, vals);
}

export async function updateItemStatus(
  id: string,
  status: string,
  clientId: number
) {
  return pool.query(
    "UPDATE processed_items SET status = $1, updated_at = NOW() WHERE id = $2 AND client_id = $3 RETURNING *",
    [status, id, clientId]
  );
}

export async function getItems(clientId: number, category?: string) {
  if (category) {
    return pool.query(
      "SELECT * FROM processed_items WHERE client_id = $1 AND category = $2 ORDER BY processed_at DESC",
      [clientId, category]
    );
  }
  return pool.query(
    "SELECT * FROM processed_items WHERE client_id = $1 ORDER BY processed_at DESC",
    [clientId]
  );
}

export async function getDashboardSummary(clientId: number) {
  return pool.query(
    "SELECT category, status, COUNT(*) as count, SUM(amount) as total " +
    "FROM processed_items WHERE client_id = $1 " +
    "GROUP BY category, status ORDER BY category, status",
    [clientId]
  );
}

export default pool;