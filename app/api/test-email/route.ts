import { NextResponse } from "next/server";

// Must match lib/email.ts FROM_EMAIL exactly so this test reproduces
// production conditions (display-name format, not bare address).
const FROM_EMAIL = "Dreamward <hello@godreamward.com>";
const TEST_TO = "jacobse.richard@gmail.com";

export async function GET() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        stage: "env_check",
        error: "RESEND_API_KEY is not set in this environment",
      },
      { status: 500 }
    );
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: TEST_TO,
        subject: "Dreamward Test Email",
        html: "<p>If you see this, Resend is working from the deployed Vercel function.</p>",
      }),
    });

    let resendResponse: unknown;
    try {
      resendResponse = await res.json();
    } catch {
      resendResponse = await res.text();
    }

    return NextResponse.json({
      stage: "resend_call",
      httpStatus: res.status,
      ok: res.ok,
      resendResponse,
      keyPrefix: apiKey.substring(0, 8) + "...",
      keyLength: apiKey.length,
      from: FROM_EMAIL,
      to: TEST_TO,
    });
  } catch (err) {
    const error = err as { message?: string; name?: string };
    return NextResponse.json(
      {
        stage: "fetch_failed",
        error: error.message || "Unknown error",
        name: error.name || "Error",
      },
      { status: 500 }
    );
  }
}
