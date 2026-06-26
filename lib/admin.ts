// lib/admin.ts
//
// Owner/admin access gate for the /admin owner dashboard + its APIs.
// Single source of truth so every admin surface checks the same allowlist.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/** The owner email allowlist. Defaults to Jacob's two logins so the owner
 *  dashboard works out of the box; override in prod via the ADMIN_EMAILS
 *  env var (comma-separated). */
export function getAdminEmails(): string[] {
  return (
    process.env.ADMIN_EMAILS ||
    "jacobse.richard@gmail.com,dreamwardsystems@gmail.com"
  )
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
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
