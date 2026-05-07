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
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-3 sm:p-6 font-sans">
      <div className="bg-white rounded-xl border border-slate-200 py-8 px-6 sm:py-11 sm:px-10 max-w-md w-full text-center">
        <div className="inline-flex items-center gap-2.5 mb-2">
          <span className="text-3xl">{"⚡"}</span>
          <span className="text-3xl font-extrabold text-slate-900 tracking-tight">
            FlowWork
          </span>
        </div>
        <p className="text-[15px] text-slate-500 mb-8">Sign in to continue</p>
        {friendlyError && (
          <div className="bg-red-50 border border-red-200 text-red-800 py-2.5 px-3.5 rounded-lg text-[13px] mb-4 text-left">
            {friendlyError}
          </div>
        )}
        <button
          onClick={handleSignIn}
          disabled={submitting}
          className="w-full py-3 px-5 rounded-[10px] border border-slate-200 bg-white cursor-pointer text-[15px] font-semibold text-slate-800 inline-flex items-center justify-center gap-3 disabled:opacity-60 disabled:cursor-wait"
        >
          <GoogleIcon />
          <span>{submitting ? "Redirecting..." : "Sign in with Google"}</span>
        </button>
        <div className="mt-6 text-[13px] text-slate-400">
          <a href="/privacy" className="text-slate-500 no-underline mx-1.5">
            Privacy
          </a>
          <span className="text-slate-300">{"·"}</span>
          <a href="/terms" className="text-slate-500 no-underline mx-1.5">
            Terms
          </a>
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
