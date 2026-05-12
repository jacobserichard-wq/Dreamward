import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --- Client Management ---

export async function getOrCreateClient(email: string) {
  const existing = await pool.query(
    "SELECT * FROM clients WHERE email = $1",
    [email]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0];
  }
  const result = await pool.query(
    "INSERT INTO clients (email) VALUES ($1) RETURNING *",
    [email]
  );
  await pool.query(
    "INSERT INTO client_settings (client_id) VALUES ($1)",
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
    "ai_classified_at, ai_model, original_ai_category) " +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) " +
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