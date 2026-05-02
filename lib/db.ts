import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

let initialized = false;

async function initDb() {
  if (initialized) return;
  const client = await pool.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS processed_items (" +
      "id SERIAL PRIMARY KEY, " +
      "vendor VARCHAR(255) NOT NULL, " +
      "invoice_number VARCHAR(100), " +
      "amount DECIMAL(12,2) DEFAULT 0, " +
      "due_date DATE, " +
      "status VARCHAR(20) NOT NULL DEFAULT ''needs_review'', " +
      "category VARCHAR(20) NOT NULL, " +
      "confidence INTEGER DEFAULT 0, " +
      "summary TEXT, " +
      "raw_email_id VARCHAR(255), " +
      "extracted_data JSONB, " +
      "processed_at TIMESTAMPTZ DEFAULT NOW(), " +
      "updated_at TIMESTAMPTZ DEFAULT NOW())"
    );
    initialized = true;
  } finally {
    client.release();
  }
}

export async function query(
  text: string,
  params?: unknown[]
) {
  await initDb();
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export async function saveProcessedItem(item: {
  vendor: string;
  invoiceNumber: string;
  amount: number;
  dueDate: string | null;
  status: string;
  category: string;
  confidence: number;
  summary: string;
  rawEmailId: string;
  extractedData: Record<string, unknown>;
}) {
  const sql =
    "INSERT INTO processed_items " +
    "(vendor, invoice_number, amount, due_date, " +
    "status, category, confidence, summary, " +
    "raw_email_id, extracted_data) " +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) " +
    "RETURNING *";
  const vals = [
    item.vendor,
    item.invoiceNumber,
    item.amount,
    item.dueDate || null,
    item.status,
    item.category,
    item.confidence,
    item.summary,
    item.rawEmailId,
    JSON.stringify(item.extractedData),
  ];
  return query(sql, vals);
}

export async function getProcessedItems(filters?: {
  category?: string;
  status?: string;
  limit?: number;
}) {
  let sql = "SELECT * FROM processed_items WHERE 1=1";
  const params: unknown[] = [];
  if (filters?.category) {
    params.push(filters.category);
    sql += " AND category = $" + params.length;
  }
  if (filters?.status) {
    params.push(filters.status);
    sql += " AND status = $" + params.length;
  }
  sql += " ORDER BY processed_at DESC";
  if (filters?.limit) {
    params.push(filters.limit);
    sql += " LIMIT $" + params.length;
  }
  return query(sql, params);
}

export async function getDashboardSummary() {
  const sql =
    "SELECT category, status, " +
    "COUNT(*)::int as item_count, " +
    "COALESCE(SUM(amount),0)::float as total_amount " +
    "FROM processed_items " +
    "GROUP BY category, status " +
    "ORDER BY category, status";
  return query(sql);
}

export async function updateItemStatus(
  id: string,
  status: string
) {
  const sql =
    "UPDATE processed_items " +
    "SET status = $2, updated_at = NOW() " +
    "WHERE id = $1 RETURNING *";
  return query(sql, [id, status]);
}

export default pool;
