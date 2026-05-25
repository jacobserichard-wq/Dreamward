// lib/crypto.ts
//
// Phase 8a commit 2 of 5. Designed in
// session-notes/phase-8-shopify-design.md §4 (lib/crypto.ts shape).
//
// AES-256-GCM symmetric encryption for sensitive secrets at rest.
// First consumer: Shopify access tokens (lib/shopify.ts + the OAuth
// callback route). Pattern is reusable for any future integration's
// API tokens (Etsy, Square, etc.) — all of those reuse this module.
//
// Algorithm choice: AES-256-GCM
//   - Authenticated encryption (the auth tag detects tampering /
//     wrong-key on decrypt — fails cleanly rather than returning
//     garbled bytes)
//   - 12-byte IV is GCM standard (NIST SP 800-38D §8.2)
//   - 16-byte auth tag is GCM default + secure
//   - Available in Node's built-in `crypto` module — zero deps
//
// Key handling:
//   - 32-byte (256-bit) raw key, supplied as 64-char hex string in
//     SHOPIFY_TOKEN_ENCRYPTION_KEY env var
//   - Generated once by the operator with:
//       node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//   - Stored in Vercel env vars (Production + Preview). Treat as
//     CRITICAL: losing the key means every encrypted token in the
//     DB becomes un-decryptable (forced re-connect for every customer).
//
// Future key rotation: this module reads the key fresh on every
// call (no module-level cache), so rotation is a Vercel env var
// change + re-encrypt-all script. Out of scope for v1; will live
// at scripts/rotate-encryption-key.mjs if needed.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm" as const;
const KEY_LENGTH_BYTES = 32;        // AES-256 requires a 256-bit key
const IV_LENGTH_BYTES = 12;         // GCM standard (NIST recommendation)
const AUTH_TAG_LENGTH_BYTES = 16;   // GCM standard

/** A single encrypted blob. All three components must be persisted
 *  to reconstruct the original plaintext. */
export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/**
 * Encrypt a UTF-8 string with the configured key. Generates a fresh
 * random IV every call (NEVER reuse an IV with the same key — GCM
 * security collapses if you do).
 *
 * @throws if the env-var key is missing, malformed, or wrong length
 */
export function encryptToken(plaintext: string): EncryptedBlob {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

/**
 * Decrypt a previously-encrypted blob back to its UTF-8 plaintext.
 *
 * @throws if the env-var key is missing/malformed
 * @throws "Decryption failed — bad key or tampered ciphertext" if the
 *         auth tag doesn't match (wrong key, modified ciphertext, etc.)
 */
export function decryptToken(blob: EncryptedBlob): string {
  const key = loadKey();
  const decipher = createDecipheriv(ALGORITHM, key, blob.iv);
  decipher.setAuthTag(blob.authTag);
  try {
    const plaintext = Buffer.concat([
      decipher.update(blob.ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    // GCM's `final()` throws on auth-tag mismatch. Re-throw with a
    // clearer message that won't leak the underlying crypto error.
    throw new Error("Decryption failed — bad key or tampered ciphertext");
  }
}

/**
 * Load the AES-256-GCM key from SHOPIFY_TOKEN_ENCRYPTION_KEY env var.
 * Pure helper; each encrypt/decrypt call re-reads so a Vercel env var
 * change (key rotation) takes effect on the next request without a
 * code redeploy.
 *
 * Throws clearly so the route handler can distinguish "config error"
 * from "ciphertext tampered" in its error response.
 */
function loadKey(): Buffer {
  const hex = process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "SHOPIFY_TOKEN_ENCRYPTION_KEY env var is not set. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(
      "SHOPIFY_TOKEN_ENCRYPTION_KEY must be a hex string (0-9 + a-f only)."
    );
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `SHOPIFY_TOKEN_ENCRYPTION_KEY must be exactly ${KEY_LENGTH_BYTES} bytes (${KEY_LENGTH_BYTES * 2} hex chars). Got ${key.length} bytes.`
    );
  }
  return key;
}

/**
 * Convenience helper: encrypt + return the three components as Buffers
 * ready to bind into a parameterized SQL INSERT. The OAuth callback
 * route uses this to keep the route code tight:
 *
 *   const { ciphertext, iv, authTag } = encryptForDb(accessToken);
 *   await pool.query(
 *     `INSERT INTO shopify_connections
 *        (..., access_token_ciphertext, access_token_iv, access_token_auth_tag)
 *      VALUES ($1, $2, $3, ...)`,
 *     [..., ciphertext, iv, authTag]
 *   );
 */
export function encryptForDb(plaintext: string): EncryptedBlob {
  return encryptToken(plaintext);
}

/**
 * Mirror helper: decrypt from DB columns. Reads come back from pg as
 * Buffers when the column type is BYTEA, so the caller just passes
 * the three columns straight in.
 */
export function decryptFromDb(opts: {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}): string {
  return decryptToken(opts);
}
