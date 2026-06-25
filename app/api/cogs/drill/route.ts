// app/api/cogs/drill/route.ts
//
// Phase 12f commit 3. The transparency endpoint — answers
// "show me the EXACT line items that produced this revenue
// and COGS number, and the EXACT cost-history row used for
// each." Powers the CogsAuditTrailModal on /cogs.
//
// GET /api/cogs/drill?from=YYYY-MM-DD&to=YYYY-MM-DD&scope=...&id=...
//   scope variants:
//     - 'totals'      → every paid line item in the period
//     - 'channel'     → filter by processed_items.channel = id
//                       (id may be the literal string "null" for
//                        the "uncategorized" bucket)
//     - 'sku'         → filter by matched_sku_id = id
//     - 'unmatched'   → matched_sku_id IS NULL (id ignored)
//
//   Returns: {
//     lineItems: AuditLineItem[],
//     summary:   MarginTotals,
//   }
//
// The killer field is `costSource` on each line item:
//   { historyId, effectiveDate, costPerUnit }  OR  null
//
// That tells the user EXACTLY which sku_cost_history row was used
// for this sale's COGS — the visible audit trail Crafty Base
// users explicitly asked for ("they have to blindly trust the
// software's final COGS number without a clear, visual audit
// trail"). Our number can be re-derived in spreadsheet by anyone
// with this data.
//
// Pro-gated. Tenant-scoped via every WHERE clause.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";

type Scope = "totals" | "channel" | "sku" | "unmatched";

interface DrillRowDb {
  id: number;
  parent_id: number;
  parent_source: string | null;
  parent_source_ref_id: string | null;
  parent_channel: string | null;
  parent_vendor: string | null;
  parent_invoice_number: string | null;
  platform: string;
  external_id: string;
  external_item_id: string | null;
  name: string;
  quantity: string;
  unit_price: string;
  currency: string;
  sold_at: string;
  matched_sku_id: number | null;
  matched_sku_code: string | null;
  matched_sku_name: string | null;
  cogs_amount: string | null;
  cogs_is_estimated: boolean;
  /** FIFO layers this line item drained — the audit trail. */
  layers:
    | Array<{
        layerId: number;
        source: string;
        acquiredAt: string;
        unitCost: string;
        quantity: string;
        isEstimated: boolean;
      }>
    | null;
}

export async function GET(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "This feature requires an active subscription." },
        { status: 403 }
      );
    }

    const params = req.nextUrl.searchParams;
    const from = params.get("from");
    const to = params.get("to");
    if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return NextResponse.json(
        { error: "from must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    if (!to || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json(
        { error: "to must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    const scope = (params.get("scope") ?? "totals") as Scope;
    if (!["totals", "channel", "sku", "unmatched"].includes(scope)) {
      return NextResponse.json(
        { error: "Invalid scope" },
        { status: 400 }
      );
    }
    const idParam = params.get("id");

    // Build per-scope WHERE additions. We always reference $4 in
    // the WHERE clause (even when unused) so node-postgres doesn't
    // choke on parameter type inference; the OR-with-true trick
    // collapses the predicate.
    const extraArgs: unknown[] = [];
    let extraWhere = "";
    if (scope === "channel") {
      // id may be the literal "null" for the uncategorized bucket
      if (idParam === "null" || idParam === null) {
        extraWhere = "AND pi.channel IS NULL";
      } else {
        extraWhere = `AND pi.channel = $${4 + extraArgs.length}`;
        extraArgs.push(idParam);
      }
    } else if (scope === "sku") {
      const skuId = Number(idParam);
      if (!Number.isInteger(skuId) || skuId <= 0) {
        return NextResponse.json(
          { error: "scope=sku requires id=<positive int>" },
          { status: 400 }
        );
      }
      extraWhere = `AND pili.matched_sku_id = $${4 + extraArgs.length}`;
      extraArgs.push(skuId);
    } else if (scope === "unmatched") {
      extraWhere = "AND pili.matched_sku_id IS NULL";
    }

    // Cap rows returned so a "show me everything" totals drill on
    // a huge catalog doesn't blow up the JSON payload. 1000 is
    // generous for a typical period; UI shows "(of N total)" if
    // truncated.
    const ROW_CAP = 1000;

    const rows = await pool.query<DrillRowDb>(
      `SELECT pili.id,
              pi.id                  AS parent_id,
              pi.source              AS parent_source,
              pi.source_ref_id       AS parent_source_ref_id,
              pi.channel             AS parent_channel,
              pi.vendor              AS parent_vendor,
              pi.invoice_number      AS parent_invoice_number,
              pili.platform,
              pili.external_id,
              pili.external_item_id,
              pili.name,
              pili.quantity::text,
              pili.unit_price::text,
              pili.currency,
              pili.sold_at::text,
              pili.matched_sku_id,
              s.code                 AS matched_sku_code,
              s.name                 AS matched_sku_name,
              pili.cogs_amount::text AS cogs_amount,
              pili.cogs_is_estimated,
              lyr.layers
         FROM processed_item_line_items pili
         JOIN processed_items pi ON pi.id = pili.processed_item_id
         LEFT JOIN skus s ON s.id = pili.matched_sku_id
         LEFT JOIN LATERAL (
           SELECT json_agg(
                    json_build_object(
                      'layerId',    cl.id,
                      'source',     cl.source,
                      'acquiredAt', cl.acquired_at::text,
                      'unitCost',   cc.unit_cost::text,
                      'quantity',   cc.consumed_qty::text,
                      'isEstimated', cc.is_estimated
                    )
                    ORDER BY cl.acquired_at, cl.id
                  ) AS layers
             FROM cost_consumptions cc
             JOIN cost_layers cl ON cl.id = cc.layer_id
            WHERE cc.line_item_id = pili.id
         ) lyr ON true
        WHERE pili.client_id = $1
          AND pili.sold_at >= $2
          AND pili.sold_at <= $3
          AND pi.status = 'paid'
          ${extraWhere}
        ORDER BY pili.sold_at DESC, pili.id DESC
        LIMIT ${ROW_CAP + 1}`,
      [client.id, from, to, ...extraArgs]
    );

    const truncated = rows.rowCount! > ROW_CAP;
    const used = rows.rows.slice(0, ROW_CAP);

    // Build the summary in the same pass.
    let revenue = 0;
    let cogs = 0;
    let unmatchedRevenue = 0;
    let unmatchedLineItemCount = 0;
    let cogsEstimatedLineItemCount = 0;
    const lineItems = used.map((r) => {
      const qty = Number(r.quantity) || 0;
      const unitPrice = Number(r.unit_price) || 0;
      const lineRevenue = qty * unitPrice;
      // FIFO COGS is the amount stamped on the line item at sale time, not
      // a recomputed date lookup — keeps the drill identical to the
      // headline number. The layer list is the audit trail.
      const lineCogs = r.cogs_amount != null ? Number(r.cogs_amount) : 0;
      revenue += lineRevenue;
      cogs += lineCogs;
      if (r.matched_sku_id === null) {
        unmatchedRevenue += lineRevenue;
        unmatchedLineItemCount += 1;
      }
      if (r.cogs_is_estimated) cogsEstimatedLineItemCount += 1;
      const layers = (r.layers ?? []).map((l) => ({
        layerId: l.layerId,
        source: l.source,
        acquiredAt: l.acquiredAt,
        unitCost: Number(l.unitCost) || 0,
        quantity: Number(l.quantity) || 0,
        isEstimated: l.isEstimated,
      }));
      return {
        id: r.id,
        parentId: r.parent_id,
        parentSource: r.parent_source,
        parentSourceRefId: r.parent_source_ref_id,
        parentChannel: r.parent_channel,
        parentVendor: r.parent_vendor,
        parentInvoiceNumber: r.parent_invoice_number,
        platform: r.platform,
        externalId: r.external_id,
        externalItemId: r.external_item_id,
        name: r.name,
        quantity: qty,
        unitPrice,
        revenue: lineRevenue,
        currency: r.currency,
        soldAt: r.sold_at,
        matchedSkuId: r.matched_sku_id,
        matchedSkuCode: r.matched_sku_code,
        matchedSkuName: r.matched_sku_name,
        // FIFO audit trail: the exact layers this sale drained, oldest
        // first. cogsIsEstimated = part of the cost is a fallback (stock
        // went negative / no layer), so the layers may not sum to cogs.
        costLayers: layers,
        cogsIsEstimated: r.cogs_is_estimated,
        cogs: lineCogs,
      };
    });

    const margin = revenue - cogs;
    return NextResponse.json({
      lineItems,
      summary: {
        revenue,
        cogs,
        margin,
        marginPercent: revenue > 0 ? (margin / revenue) * 100 : null,
        unmatchedRevenue,
        unmatchedLineItemCount,
        cogsEstimatedLineItemCount,
        totalLineItemCount: lineItems.length,
      },
      truncated,
    });
  } catch (err) {
    console.error("COGS drill GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load drill" },
      { status: 500 }
    );
  }
}
