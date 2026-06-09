import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { FEATURES } from "./features";

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
  ],
  callbacks: {
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
