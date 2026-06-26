// app/api/admin/costs/route.ts
//
// Owner-only CRUD for operating-cost line items shown on the /admin owner
// dashboard. GET (list) + POST (create); PATCH/DELETE live at [id].

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminSessionEmail } from "@/lib/admin";

interface CostRowDb {
  id: number;
  label: string;
  amount: string;
  cadence: string;
  notes: string | null;
}

export async function GET() {
  const admin = await getAdminSessionEmail();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const res = await pool.query<CostRowDb>(
    `SELECT id, label, amount::text AS amount, cadence, notes
       FROM owner_costs ORDER BY id`
  );
  return NextResponse.json({
    costs: res.rows.map((r) => ({
      id: r.id,
      label: r.label,
      amount: Number(r.amount),
      cadence: r.cadence,
      notes: r.notes,
    })),
  });
}

export async function POST(req: NextRequest) {
  const admin = await getAdminSessionEmail();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as {
    label?: unknown;
    amount?: unknown;
    cadence?: unknown;
    notes?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) {
    return NextResponse.json({ error: "Label is required" }, { status: 400 });
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json(
      { error: "Amount must be a number ≥ 0" },
      { status: 400 }
    );
  }
  const cadence = body.cadence === "annual" ? "annual" : "monthly";
  const notes =
    typeof body.notes === "string" && body.notes.trim()
      ? body.notes.trim()
      : null;

  const res = await pool.query<{ id: number }>(
    `INSERT INTO owner_costs (label, amount, cadence, notes)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [label, amount, cadence, notes]
  );
  return NextResponse.json({ id: res.rows[0].id });
}
