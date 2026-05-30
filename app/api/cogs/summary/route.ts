// app/api/cogs/summary/route.ts
//
// Phase 12f commit 1. The data feed for /cogs dashboard.
//
// GET /api/cogs/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
//   Returns: {
//     period:    { from, to },
//     totals:    MarginTotals,
//     byChannel: ChannelMarginRow[],
//     bySku:     SkuMarginRow[]   // top 100 by revenue
//   }
//
// Date range required. Caller supplies the from/to bounds; the
// dashboard's period selector hands "Last 7 days" / "This month" /
// "Last quarter" / "Custom" as concrete date strings.
//
// Pro-gated. Tenant-scoped via every underlying compute query
// (all client_id = $1).

import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import {
  computeMargin,
  computeMarginByChannel,
  computeMarginBySku,
} from "@/lib/cogs/compute";

export async function GET(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }
    if (client.plan !== "pro") {
      return NextResponse.json(
        { error: "COGS reporting is a Pro feature." },
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
    if (from > to) {
      return NextResponse.json(
        { error: "from must be on or before to" },
        { status: 400 }
      );
    }

    // Three parallel queries — none depends on the others.
    const [totals, byChannel, bySku] = await Promise.all([
      computeMargin({
        clientId: client.id,
        periodStart: from,
        periodEnd: to,
      }),
      computeMarginByChannel({
        clientId: client.id,
        periodStart: from,
        periodEnd: to,
      }),
      computeMarginBySku({
        clientId: client.id,
        periodStart: from,
        periodEnd: to,
        limit: 100,
      }),
    ]);

    return NextResponse.json({
      period: { from, to },
      totals,
      byChannel,
      bySku,
    });
  } catch (err) {
    console.error("COGS summary GET error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to load summary",
      },
      { status: 500 }
    );
  }
}
