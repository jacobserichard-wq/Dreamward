import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function saveProcessedItem(item: any) {
    const emailId = item.raw_email_id || item.rawEmailId || null;
  if (emailId) {
    const existing = await pool.query(
      "SELECT id FROM processed_items WHERE raw_email_id = $1",
      [emailId]
    );
    if (existing.rows.length > 0) {
      return existing;
    }
  }
  const sql =
    "INSERT INTO processed_items " +
    "(vendor, invoice_number, amount, due_date, " +
    "status, category, confidence, summary, " +
    "raw_email_id, extracted_data) " +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) " +
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
    item.emailId,
    (item.extracted_data || item.extractedData)
      ? JSON.stringify(item.extracted_data || item.extractedData)
      : null,
  ];
  return pool.query(sql, vals);
}

export async function updateItemStatus(id: string, status: string) {
  return pool.query(
    "UPDATE processed_items " +
    "SET status = $1, updated_at = NOW() " +
    "WHERE id = $2 RETURNING *",
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