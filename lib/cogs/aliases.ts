// lib/cogs/aliases.ts
//
// Phase 12d shared library for sku_aliases creation. Wraps the
// INSERT in a transaction that ALSO retroactively resolves
// matched_sku_id on every existing processed_item_line_items row
// that was waiting for this alias to exist.
//
// This is the key Crafty-Killer feature for the SKU mapping
// experience: when the merchant maps "Square POS Custom Item 'CB1'"
// to FlowWork SKU CB1, every historical sale of that item lights
// up COGS instantly — no manual re-sync, no Manufacturing Run,
// no spreadsheet wrangling.
//
// Called from:
//   - POST /api/sku-aliases             (manual mapping in /skus/unmatched)
//   - POST /api/skus/bulk-import        (Phase 12e catalog pull)
//
// Tenant-safe: the auto-resolve UPDATE uses processed_item_line_items.client_id
// to scope, and the inserter validates that the targeted SKU belongs to
// the calling client before doing anything.

import type { PoolClient } from "pg";
import pool from "@/lib/db";
import {
  recordSaleAdjustments,
  reverseSaleAdjustments,
} from "@/lib/inventory/adjustments";

export type AliasPlatform = "shopify" | "wix" | "square";

export interface AliasCreateInput {
  /** FlowWork SKU id. Must belong to the calling client_id — the
   *  insert sub-select enforces this. */
  skuId: number;
  platform: AliasPlatform;
  /** Platform-side product/variant id (Shopify variant_id as string,
   *  Wix catalogItemId UUID, Square catalog_object_id). */
  externalId: string;
  /** Platform-side SKU code (display only). */
  externalSku?: string | null;
}

export interface AliasCreateResult {
  /** The new sku_aliases row id. */
  aliasId: number;
  /** How many existing processed_item_line_items rows the auto-
   *  resolve UPDATE just filled in. The Unmatched UI surfaces this
   *  number in the success toast ("Mapped 47 historical sales"). */
  resolvedCount: number;
}

/**
 * Create one sku_alias and retroactively resolve matched_sku_id
 * on every existing processed_item_line_items row that matches
 * (platform, external_id) within the same tenant.
 *
 * Throws on:
 *   - SQU 23505 (duplicate alias for (platform, external_id))
 *     — caller should map to a 409 "already mapped" response
 *   - SKU not found / wrong client_id — RETURNING is empty,
 *     caller throws 404
 *
 * Pass `dbClient` when called inside an outer transaction (e.g.,
 * Phase 12e bulk-import does many aliases per request).
 */
export async function createAliasWithResolve(opts: {
  dbClient?: PoolClient;
  clientId: number;
  alias: AliasCreateInput;
}): Promise<AliasCreateResult> {
  const { clientId, alias } = opts;
  const db = opts.dbClient ?? pool;

  // ── 1. INSERT alias, tenant-scoped via SELECT-into-INSERT ────
  // The SELECT confirms the SKU belongs to this client. Without
  // it, a forged sku_id could mint an alias under someone else's
  // catalog.
  const insertRes = await db.query<{ id: number }>(
    `INSERT INTO sku_aliases (sku_id, platform, external_id, external_sku)
     SELECT $1, $2, $3, $4
       FROM skus
      WHERE id = $1 AND client_id = $5
     RETURNING id`,
    [alias.skuId, alias.platform, alias.externalId, alias.externalSku ?? null, clientId]
  );

  if (insertRes.rowCount === 0) {
    // SKU didn't exist (or belonged to another tenant). 23505 would
    // have thrown above for duplicate alias — this rowCount=0 path
    // is the "no such SKU" case.
    const err = new Error("SKU not found") as Error & { code?: string };
    err.code = "SKU_NOT_FOUND";
    throw err;
  }

  const aliasId = insertRes.rows[0].id;

  // ── 2. Retroactively resolve matched_sku_id ──────────────────
  // Every processed_item_line_items row with NULL matched_sku_id
  // and matching (platform, external_item_id) under this tenant
  // gets filled in with the new SKU. Crafty Base's users have to
  // re-import or manually adjust historical sales when they fix
  // a SKU mapping — this single UPDATE does it for them.
  const resolveRes = await db.query<{ id: number; quantity: string }>(
    `UPDATE processed_item_line_items
        SET matched_sku_id = $1
      WHERE client_id = $2
        AND platform = $3
        AND external_item_id = $4
        AND matched_sku_id IS NULL
      RETURNING id, quantity`,
    [alias.skuId, clientId, alias.platform, alias.externalId]
  );

  // Sub-session 33 Tier 1 commit 2: inventory backfill. Every
  // historical line item we just resolved becomes a sale-adjustment
  // and decrements stock. Without this hook the running stock count
  // would silently miss every sale that happened before the alias
  // got created — exactly the data-quality issue the comparison
  // page calls out about Crafty Base.
  if ((resolveRes.rowCount ?? 0) > 0) {
    await recordSaleAdjustments({
      dbClient: opts.dbClient,
      items: resolveRes.rows.map((r) => ({
        lineItemId: r.id,
        skuId: alias.skuId,
        quantity: parseFloat(r.quantity),
      })),
    });
  }

  return {
    aliasId,
    resolvedCount: resolveRes.rowCount ?? 0,
  };
}

/**
 * Delete a sku_alias and clear matched_sku_id on every line item
 * that was resolved through it. Used by the "unmap" path on the
 * /skus/[id] detail page (Phase 12d.5 — surfaced if a merchant
 * realizes they mapped the wrong thing).
 *
 * The clear-on-unmap behavior is deliberate: if the alias is wrong,
 * its historical resolutions are equally wrong. Returning items to
 * unmatched lets the merchant re-map.
 */
export async function deleteAliasAndUnresolve(opts: {
  dbClient?: PoolClient;
  clientId: number;
  aliasId: number;
}): Promise<{ deleted: boolean; unresolvedCount: number }> {
  const { clientId, aliasId } = opts;
  const db = opts.dbClient ?? pool;

  // ── 1. Load the alias details (need platform + external_id for
  // the unresolve step, AFTER deletion would be too late). Tenant-
  // scoped via JOIN to skus.
  const lookupRes = await db.query<{
    platform: string;
    external_id: string;
    sku_id: number;
  }>(
    `SELECT a.platform, a.external_id, a.sku_id
       FROM sku_aliases a
       JOIN skus s ON s.id = a.sku_id
      WHERE a.id = $1 AND s.client_id = $2`,
    [aliasId, clientId]
  );

  if (lookupRes.rowCount === 0) {
    return { deleted: false, unresolvedCount: 0 };
  }
  const { platform, external_id, sku_id } = lookupRes.rows[0];

  // ── 2. Clear matched_sku_id on the line items that resolved
  // through this alias. Scoped by sku_id so we don't accidentally
  // clear matches from OTHER aliases that happen to point at the
  // same SKU. (One SKU can have multiple aliases across platforms;
  // deleting the Wix alias shouldn't unresolve Shopify line items.)
  //
  // RETURNING gives us the line-item ids so the inventory step can
  // reverse their sale adjustments and credit stock back.
  const unresolveRes = await db.query<{ id: number }>(
    `UPDATE processed_item_line_items
        SET matched_sku_id = NULL
      WHERE client_id = $1
        AND platform = $2
        AND external_item_id = $3
        AND matched_sku_id = $4
      RETURNING id`,
    [clientId, platform, external_id, sku_id]
  );

  // Sub-session 33 Tier 1 commit 2: undo the inventory side-effects
  // of every line item we just unresolved. The DELETE goes BEFORE
  // the alias DELETE so we still have the line-item references; the
  // reverseSaleAdjustments helper removes the ledger rows + credits
  // stock back atomically per SKU.
  if ((unresolveRes.rowCount ?? 0) > 0) {
    await reverseSaleAdjustments({
      dbClient: opts.dbClient,
      lineItemIds: unresolveRes.rows.map((r) => r.id),
    });
  }

  // ── 3. Delete the alias.
  await db.query(`DELETE FROM sku_aliases WHERE id = $1`, [aliasId]);

  return {
    deleted: true,
    unresolvedCount: unresolveRes.rowCount ?? 0,
  };
}
