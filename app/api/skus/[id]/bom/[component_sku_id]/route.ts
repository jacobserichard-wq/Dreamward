// app/api/skus/[id]/bom/[component_sku_id]/route.ts
//
// Tier 2 commit 3. Remove one component from a finished SKU's
// recipe.
//
// DELETE /api/skus/[id]/bom/[component_sku_id]
//   Returns: { deleted: boolean }
//
// Tenant-scoped via client_id on bom_components. Paying-tier gated.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; component_sku_id: string }> }
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

    const { id: idParam, component_sku_id: compParam } = await params;
    const parentId = Number(idParam);
    const componentSkuId = Number(compParam);
    if (
      !Number.isInteger(parentId) ||
      parentId <= 0 ||
      !Number.isInteger(componentSkuId) ||
      componentSkuId <= 0
    ) {
      return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
    }

    const res = await pool.query(
      `DELETE FROM bom_components
        WHERE parent_sku_id = $1
          AND component_sku_id = $2
          AND client_id = $3
       RETURNING id`,
      [parentId, componentSkuId, client.id]
    );

    return NextResponse.json({ deleted: (res.rowCount ?? 0) > 0 });
  } catch (err) {
    console.error("BOM DELETE error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to remove component" },
      { status: 500 }
    );
  }
}
