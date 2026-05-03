import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import pool from "@/lib/db";
import { sendEmail, welcomeEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { businessName, industry } = await req.json();
    if (!businessName || !industry) {
      return NextResponse.json({ error: "Business name and industry are required" }, { status: 400 });
    }

    await pool.query(
      `UPDATE clients 
       SET business_name = $1, industry = $2, onboarding_completed = true, updated_at = NOW() 
       WHERE id = $3`,
      [businessName, industry, client.id]
    );

    // Send welcome email (don't block the response if it fails)
    const { subject, html } = welcomeEmail(businessName);
    sendEmail({ to: client.email, subject, html }).catch((err) =>
      console.error("Welcome email failed:", err)
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Onboarding error:", error);
    return NextResponse.json({ error: "Failed to save onboarding" }, { status: 500 });
  }
}