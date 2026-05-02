export async function saveProcessedItem(item: any) {
  const sql =
    "INSERT INTO processed_items " +
    "(vendor, invoice_number, amount, due_date, " +
    "status, category, confidence, summary, " +
    "raw_email_id, extracted_data) " +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) " +
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
    item.extracted_data ? JSON.stringify(item.extracted_data) : null
  ];
  return query(sql, vals);
}