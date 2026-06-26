import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminSessionEmail } from "@/lib/admin";

export async function GET(req: NextRequest) {
  try {
    const admin = await getAdminSessionEmail();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const clientId = req.nextUrl.searchParams.get("id");
    if (!clientId) {
      return NextResponse.json({ error: "Client ID required" }, { status: 400 });
    }

    const clientResult = await pool.query(
      `SELECT * FROM clients WHERE id = $1`,
      [parseInt(clientId)]
    );

    if (clientResult.rows.length === 0) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const settingsResult = await pool.query(
      `SELECT * FROM client_settings WHERE client_id = $1`,
      [parseInt(clientId)]
    );

    const itemsResult = await pool.query(
      `SELECT id, vendor, invoice_number, category, amount, status, due_date, source, confidence, summary, processed_at
       FROM processed_items 
       WHERE client_id = $1 
       ORDER BY processed_at DESC 
       LIMIT 25`,
      [parseInt(clientId)]
    );

    const statsResult = await pool.query(
      `SELECT 
         COUNT(*) as total_items,
         COUNT(*) FILTER (WHERE processed_at >= date_trunc('month', CURRENT_DATE)) as items_this_month,
         COUNT(*) FILTER (WHERE status = 'pending') as pending,
         COUNT(*) FILTER (WHERE status = 'paid') as paid,
         COUNT(*) FILTER (WHERE status = 'overdue') as overdue,
         COALESCE(SUM(amount), 0) as total_amount,
         COALESCE(AVG(confidence), 0) as avg_confidence
       FROM processed_items 
       WHERE client_id = $1`,
      [parseInt(clientId)]
    );

    return NextResponse.json({
      client: clientResult.rows[0],
      settings: settingsResult.rows[0] || null,
      items: itemsResult.rows,
      stats: statsResult.rows[0],
    });
  } catch (error) {
    console.error("Admin client detail error:", error);
    return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
  }
}