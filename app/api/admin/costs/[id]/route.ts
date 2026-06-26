// app/api/admin/costs/[id]/route.ts
//
// Owner-only update (PATCH) + delete (DELETE) for a single operating-cost
// line item. Partial PATCH — only the provided fields change.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminSessionEmail } from "@/lib/admin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminSessionEmail();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
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

  // Build a partial UPDATE — only provided fields. Each $N is referenced
  // (pg type inference rejects unused params).
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (typeof body.label === "string") {
    const label = body.label.trim();
    if (!label) {
      return NextResponse.json({ error: "Label can't be blank" }, { status: 400 });
    }
    sets.push(`label = $${i++}`);
    vals.push(label);
  }
  if (body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json(
        { error: "Amount must be a number ≥ 0" },
        { status: 400 }
      );
    }
    sets.push(`amount = $${i++}`);
    vals.push(amount);
  }
  if (body.cadence !== undefined) {
    sets.push(`cadence = $${i++}`);
    vals.push(body.cadence === "annual" ? "annual" : "monthly");
  }
  if (body.notes !== undefined) {
    sets.push(`notes = $${i++}`);
    vals.push(
      typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim()
        : null
    );
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  sets.push("updated_at = NOW()");
  vals.push(id);

  const res = await pool.query(
    `UPDATE owner_costs SET ${sets.join(", ")} WHERE id = $${i}`,
    vals
  );
  if (res.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminSessionEmail();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const res = await pool.query(`DELETE FROM owner_costs WHERE id = $1`, [id]);
  if (res.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
