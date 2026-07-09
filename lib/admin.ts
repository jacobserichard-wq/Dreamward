// lib/admin.ts
//
// Owner/admin access gate for the /admin owner dashboard + its APIs.
// Single source of truth so every admin surface checks the same allowlist.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/** The founder's logins ALWAYS have owner access — baked in so a misset (or
 *  leftover) ADMIN_EMAILS env var can never lock the owner out of their own
 *  dashboard. ADMIN_EMAILS just *adds* extra admins on top.
 *  Exported (2026-07-07): getOrCreateClient auto-flags these emails is_test
 *  at signup so the founder's own accounts never pollute real-customer
 *  metrics or receive billing/nag emails. */
export const OWNER_EMAILS = [
  "jacobse.richard@gmail.com",
  "dreamwardsystems@gmail.com",
];

export function getAdminEmails(): string[] {
  const fromEnv = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...OWNER_EMAILS, ...fromEnv]));
}

export function isAdminEmail(email?: string | null): boolean {
  return !!email && getAdminEmails().includes(email.toLowerCase());
}

/** Returns the lowercased email when the current session belongs to an
 *  owner, else null — for routes to 403 on. */
export async function getAdminSessionEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() ?? null;
  return isAdminEmail(email) ? email : null;
}
