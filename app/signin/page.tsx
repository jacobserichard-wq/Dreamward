"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

function SignInContent() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/";
  const errorParam = params.get("error");
  const [submitting, setSubmitting] = useState(false);

  const friendlyError =
    errorParam === "OAuthAccountNotLinked"
      ? "That email is already registered with a different sign-in method."
      : errorParam
      ? "Sign-in failed. Please try again."
      : null;

  const handleSignIn = async () => {
    setSubmitting(true);
    await signIn("google", { callbackUrl });
  };

  return (
    <div style={s.container}>
      <div
        style={s.card}
        data-tailwind-test="true"
        className="outline outline-2 outline-red-500"
      >
        <div style={s.logo}>
          <span style={s.logoIcon}>{"⚡"}</span>
          <span style={s.logoText}>FlowWork</span>
        </div>
        <p style={s.tagline}>Sign in to continue</p>
        {friendlyError && <div style={s.error}>{friendlyError}</div>}
        <button
          onClick={handleSignIn}
          disabled={submitting}
          style={{
            ...s.button,
            ...(submitting ? { opacity: 0.6, cursor: "wait" } : {}),
          }}
        >
          <GoogleIcon />
          <span>{submitting ? "Redirecting..." : "Sign in with Google"}</span>
        </button>
        <div style={s.legal}>
          <a href="/privacy" style={s.legalLink}>Privacy</a>
          <span style={s.legalDot}>{"·"}</span>
          <a href="/terms" style={s.legalLink}>Terms</a>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInContent />
    </Suspense>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f8fafc",
    padding: 24,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    background: "white",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    padding: "44px 40px",
    maxWidth: 400,
    width: "100%",
    textAlign: "center" as const,
  },
  logo: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  logoIcon: { fontSize: 32 },
  logoText: { fontSize: 28, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.5px" },
  tagline: {
    fontSize: 15,
    color: "#64748b",
    margin: "0 0 32px",
  },
  button: {
    width: "100%",
    padding: "12px 20px",
    borderRadius: 10,
    border: "1px solid #e2e8f0",
    background: "white",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 600,
    color: "#1e293b",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  error: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    padding: "10px 14px",
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 16,
    textAlign: "left" as const,
  },
  legal: {
    marginTop: 24,
    fontSize: 13,
    color: "#94a3b8",
  },
  legalLink: {
    color: "#64748b",
    textDecoration: "none",
    margin: "0 6px",
  },
  legalDot: {
    color: "#cbd5e1",
  },
};
