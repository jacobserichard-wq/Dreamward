import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const label = searchParams.get("label") || "INBOX";

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: session.accessToken });

  const gmail = google.gmail({ version: "v1", auth });

  try {
    const labelsRes = await gmail.users.labels.list({ userId: "me" });
    const targetLabel = labelsRes.data.labels?.find(
      (l) => l.name?.toLowerCase() === label.toLowerCase()
    );

    if (!targetLabel) {
      return NextResponse.json({ error: `Label "${label}" not found` }, { status: 404 });
    }

    const messagesRes = await gmail.users.messages.list({
      userId: "me",
      labelIds: [targetLabel.id!],
      maxResults: 20,
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