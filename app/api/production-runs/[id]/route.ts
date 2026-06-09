// app/api/production-runs/[id]/route.ts
//
// Tier 2 commit 4. Reverse (delete) a production run — undoes every
// stock move it caused.
//
// DELETE /api/production-runs/[id]
//   Returns: { reversed: boolean }
//
// Paying-tier gated; tenant scope enforced inside
// reverseProductionRun (client_id check).

import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";
import { reverseProductionRun } from "@/lib/inventory/production";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "This feature requires an active subscription." },
        { status: 403 }
      );
    }

    const { id: idParam } = await params;
    const runId = Number(idParam);
    if (!Number.isInteger(runId) || runId <= 0) {
      return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
    }

    const reversed = await reverseProductionRun({
      clientId: client.id,
      runId,
    });
    if (!reversed) {
      return NextResponse.json(
        { error: "Production run not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ reversed: true });
  } catch (err) {
    console.error("Production run DELETE error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to reverse run" },
      { status: 500 }
    );
  }
}
