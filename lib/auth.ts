import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { timingSafeEqual } from "crypto";
import { FEATURES } from "./features";

/** Constant-time string compare (length leak is fine — the secret is
 *  a random 20+ char password, not something guessable by length). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Sub-session 33: OAuth scope is tied to FEATURES.GMAIL_INGEST so
// the feature flag is the single point of control over Gmail
// capability. When the flag is false (default), sign-up requests
// only the basic profile/email scopes — no "sensitive scopes"
// warning on Google's consent screen, and no CASA verification
// required for public-launch readiness. When the flag is flipped
// back to true, the next sign-in re-requests the Gmail scopes
// automatically.
//
// Existing tokens for users who signed in while broader scopes
// were active stay valid until Google's refresh-token rules
// invalidate them; until then the broader scope is dormant
// because no UI surface calls a Gmail API while the flag is off.
// Minimum-friction sign-up: only request `openid email`. The
// codebase identifies clients exclusively by email (lib/getClient
// + Stripe customer_email), so name + profile picture are not
// needed. Dropping the `profile` scope removes the "see your name
// and profile picture" line from Google's consent screen — one
// less checkbox-feeling concession for a brand-new user.
const GOOGLE_SCOPE = FEATURES.GMAIL_INGEST
  ? "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.labels"
  : "openid email";

export const authOptions: NextAuthOptions = {
  pages: {
    signIn: "/signin",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: GOOGLE_SCOPE,
          access_type: "offline",
          prompt: "select_account",
        },
      },
    }),
    // Reviewer/email access (2026-07-26, App Store submission).
    // Shopify's review process explicitly disallows test accounts
    // that need Google SSO, so this single-credential side door
    // exists for their reviewers: it accepts EXACTLY the email +
    // password in REVIEWER_EMAIL / REVIEWER_PASSWORD (Vercel env)
    // and signs into that demo account (pre-created, is_test).
    // Unset env vars = provider dead (authorize always null), so
    // nothing changes for normal users unless configured. The
    // signin page shows the form behind a low-key "Sign in with
    // email" link. If email+password auth ever becomes a real
    // feature, this gets replaced by proper hashed-password auth —
    // do NOT extend this provider to look up user tables.
    CredentialsProvider({
      id: "reviewer",
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = process.env.REVIEWER_EMAIL;
        const password = process.env.REVIEWER_PASSWORD;
        if (!email || !password) return null;
        const givenEmail = (credentials?.email ?? "").trim().toLowerCase();
        const givenPassword = credentials?.password ?? "";
        if (
          safeEqual(givenEmail, email.toLowerCase()) &&
          safeEqual(givenPassword, password)
        ) {
          return { id: "reviewer", email: email.toLowerCase() };
        }
        return null;
      },
    }),
  ],
  callbacks: {
    // The whole authorization model is "session email == owner of that
    // client" (lib/getClient + Stripe customer_email), so the verified
    // email IS the security boundary. Reject any sign-in where the provider
    // explicitly says the email isn't verified. Google always sets this
    // true; this guards the day another provider is added. (Absent field →
    // allow, so we never block a provider that simply omits it.)
    async signIn({ profile }) {
      const verified = (profile as { email_verified?: boolean } | undefined)
        ?.email_verified;
      return verified !== false;
    },
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken as string;
      return session;
    },
  },
};
