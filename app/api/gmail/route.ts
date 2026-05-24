import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";
import { NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!(session as any)?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Sub-session 24 follow-up: Pro-only gating. Closes a leak where
  // any signed-in user could trigger Gmail fetches + downstream
  // Anthropic API spend regardless of their plan. Matches the README
  // marketing claim that Gmail auto-fetch is a Pro feature, and the
  // CASA security narrative built on that gating.
  const client = await getSessionClient();
  if (!client) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (client.plan !== "pro") {
    return NextResponse.json(
      {
        error:
          "Gmail auto-fetch is a Pro feature. Upgrade your plan to connect Gmail.",
      },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const label = searchParams.get("label") || "INBOX";
  const after = searchParams.get("after") || "";
  const maxResults = parseInt(searchParams.get("maxResults") || "20", 10);

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: (session as any).accessToken });

  const gmail = google.gmail({ version: "v1", auth });

  try {
    const labelsRes = await gmail.users.labels.list({ userId: "me" });
    const targetLabel = labelsRes.data.labels?.find(
      (l) => l.name?.toLowerCase() === label.toLowerCase()
    );

    if (!targetLabel) {
      return NextResponse.json({ error: `Label "${label}" not found` }, { status: 404 });
    }

    // Build query with optional date filter
    let q = "";
    if (after) {
      q = `after:${after}`;
    }

    const messagesRes = await gmail.users.messages.list({
      userId: "me",
      labelIds: [targetLabel.id!],
      maxResults: Math.min(maxResults, 100),
      q: q || undefined,
    });

    if (!messagesRes.data.messages) {
      return NextResponse.json({ messages: [], label });
    }

    const messages = await Promise.all(
      messagesRes.data.messages.map(async (msg) => {
        const full = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });

        const headers = full.data.payload?.headers;
        return {
          id: full.data.id,
          from: headers?.find((h) => h.name === "From")?.value || "",
          subject: headers?.find((h) => h.name === "Subject")?.value || "",
          date: headers?.find((h) => h.name === "Date")?.value || "",
          snippet: full.data.snippet || "",
        };
      })
    );

    return NextResponse.json({ messages, label });
  } catch (error: any) {
    console.error("Gmail API error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
