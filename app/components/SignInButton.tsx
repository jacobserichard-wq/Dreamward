// app/components/SignInButton.tsx
//
// Sub-session 24 flow redesign commit 2 of 9. Client-side island for
// the marketing landing page's primary CTA. Server-rendered landing
// page can't import next-auth/react directly, so the signIn call
// happens here in a "use client" boundary.
//
// Per locked decision #11: every signup path goes through Google
// OAuth → Trial; users upgrade to their chosen tier from /billing
// post-signin. ctaLabel is the only thing that varies between
// callers (Hero / Pricing tiles / Footer CTA all use the same
// underlying behavior).

"use client";

import { signIn } from "next-auth/react";

interface SignInButtonProps {
  /** Button label. Supports HTML entities (the marketing page passes
   *  "&rarr;" for the chevron). Rendered via dangerouslySetInnerHTML
   *  since the entity decoding doesn't fly through JSX text. */
  label: string;
  /** Where to send the user after OAuth completes. Defaults to
   *  /onboarding so the new checklist surface picks them up. */
  callbackUrl?: string;
}

export default function SignInButton({
  label,
  callbackUrl = "/onboarding",
}: SignInButtonProps) {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl })}
      className="inline-block py-3.5 px-9 rounded-full bg-eucalyptus hover:bg-eucalyptus-dark text-cream text-base font-semibold cursor-pointer border-0 transition-colors shadow-sm"
      dangerouslySetInnerHTML={{ __html: label }}
    />
  );
}
