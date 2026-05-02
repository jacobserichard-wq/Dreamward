import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function saveProcessedItem(item: any) {
  const sql =
    "INSERT INTO processed_items " +
    "(vendor, invoice_number, amount, due_date, " +
    "status, category, confidence, summary, " +
    "raw_email_id, extracted_data) " +
    "VALUES (,,,,,,,,,) " +
    "RETURNING *";
  const vals = [
    item.vendor || "Unknown",
    item.invoice_number || null,
    item.amount || 0,
    item.due_date || null,
    item.status || "needs_review",
    item.category || "invoice",
    item.confidence || 0,
    item.summary || null,
    item.raw_email_id || null,
    item.extracted_data
      ? JSON.stringify(item.extracted_data)
      : null,
  ];
  return pool.query(sql, vals);
}

export async function updateItemStatus(
  id: string,
  status: string
) {
  return pool.query(
    "UPDATE processed_items " +
    "SET status = , updated_at = NOW() " +
    "WHERE id =  RETURNING *",
    [status, id]
  );
}

export async function getDashboardSummary() {
  return pool.query(
    "SELECT category, status, " +
    "COUNT(*) as count, " +
    "SUM(amount) as total " +
    "FROM processed_items " +
    "GROUP BY category, status " +
    "ORDER BY category, status"
  );
}

export default pool;
