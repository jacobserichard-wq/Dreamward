// lib/blob.ts
//
// Phase 9.4 — thin wrapper around @vercel/blob for receipt
// uploads + deletions on expense rows.
//
// Why a wrapper instead of calling @vercel/blob directly from
// route handlers:
//   - Centralizes the pathname format (clientId/processedItemId/
//     ulid_filename) so two write paths can't accidentally diverge
//   - Forces the access:'public' setting at one spot (counterintuitive
//     name — see comment below)
//   - Adds the BLOB_READ_WRITE_TOKEN env-var check up front instead
//     of letting @vercel/blob throw an unfriendly error mid-upload
//   - Provides a single place to add file-validation later (mime
//     allowlist, virus-scan hook, etc.) without touching N callers
//
// On the "Private" store + access:'public' option:
//   Despite the SDK naming, this is the correct combination for
//   our use case. The Vercel Blob STORE is set to Private — which
//   means reads require a token AT THE BLOB SERVICE LEVEL (signed
//   URL or server-side token). The access:'public' option in put()
//   refers to URL-shape, not auth — it tells Blob to use a
//   permanent stable URL rather than a one-time-expiring upload
//   URL. With a Private store, those "public-shape" URLs still
//   require auth to fetch. See @vercel/blob docs §"Access".

import { put, del } from "@vercel/blob";

function requireToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN env var is not set. Configure it in Vercel project settings."
    );
  }
  return token;
}

export interface UploadedAttachment {
  /** Full Vercel Blob URL (https://...). Stored in DB as blob_url. */
  url: string;
  /** Pathname-only — what del() takes for cleanup. Stored as blob_pathname. */
  pathname: string;
}

/**
 * Upload a receipt to Vercel Blob.
 *
 * Pathname format:
 *   client/<clientId>/expense/<processedItemId>/<unique>-<filename>
 *
 * The clientId prefix gives us natural tenant isolation in the
 * pathname (useful for ad-hoc Blob console queries) without
 * relying on server-side auth alone. The processedItemId prefix
 * groups attachments per expense for easier debugging. The
 * unique suffix prevents two uploads of "receipt.jpg" from
 * colliding.
 */
export async function uploadAttachment(opts: {
  clientId: number;
  processedItemId: number;
  filename: string;
  contentType: string;
  body: Blob | ArrayBuffer | Buffer;
}): Promise<UploadedAttachment> {
  const token = requireToken();
  // ULID-ish: 13-char timestamp + 9-char random. Enough collision
  // resistance for a per-merchant scope without pulling in a uuid
  // dependency.
  const unique = Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
  // Sanitize filename — Blob accepts most things but slashes
  // would break the pathname structure.
  const safeName = opts.filename.replace(/[\\/]/g, "_");
  const pathname = `client/${opts.clientId}/expense/${opts.processedItemId}/${unique}-${safeName}`;

  const blob = await put(pathname, opts.body, {
    access: "public", // see header comment — URL-shape, not auth
    contentType: opts.contentType,
    token,
    addRandomSuffix: false, // we already supplied a unique prefix
  });

  return {
    url: blob.url,
    pathname: blob.pathname,
  };
}

/**
 * Delete a previously-uploaded attachment from Vercel Blob.
 * Called BEFORE the DB row deletion (so a Blob delete failure
 * leaves a row pointing at orphaned storage — recoverable —
 * rather than the inverse: a row gone + Blob bytes paid-for
 * forever).
 *
 * Silently no-ops on "blob not found" errors (already deleted,
 * or never made it past the upload). Throws on auth / network
 * problems so the caller can surface a real failure.
 */
export async function deleteAttachment(pathname: string): Promise<void> {
  const token = requireToken();
  try {
    await del(pathname, { token });
  } catch (err) {
    // Vercel Blob's del() throws BlobNotFoundError when the
    // pathname doesn't exist — that's fine, we wanted it gone
    // anyway. Re-throw anything else.
    const e = err as { name?: string; message?: string };
    if (e?.name === "BlobNotFoundError") return;
    if (
      typeof e?.message === "string" &&
      e.message.toLowerCase().includes("not found")
    ) {
      return;
    }
    throw err;
  }
}
