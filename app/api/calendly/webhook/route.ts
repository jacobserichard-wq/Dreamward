import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import pool from "@/lib/db";

// Replay protection window — reject signed payloads older than this many
// seconds. 5 min covers normal clock skew + Calendly's retry behavior;
// stale captured webhooks beyond this window won't be processed.
const SIGNATURE_MAX_AGE_SECONDS = 300;

interface ScheduledEvent {
  uri?: string;
  start_time?: string;
}

interface InviteePayload {
  email?: string;
  name?: string;
  scheduled_event?: ScheduledEvent;
  tracking?: {
    utm_content?: string;
    utm_source?: string;
    utm_campaign?: string;
  };
}

interface CalendlyEvent {
  event?: string;
  payload?: InviteePayload;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Read the raw body. Required for signature verification — JSON.parse
    //    + re-serialize would change byte ordering and invalidate the HMAC.
    const rawBody = await request.text();

    // 2. Fail-closed config check. No signing key → 500 (configuration error,
    //    not the caller's fault). Calendly retries with backoff; ops should
    //    notice the 500s and add the env var.
    const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
    if (!signingKey) {
      console.error("[calendly-webhook] CALENDLY_WEBHOOK_SIGNING_KEY not set");
      return NextResponse.json(
        { error: "Webhook not configured" },
        { status: 500 }
      );
    }

    // 3. Fail-closed signature check. Any failure (missing header, malformed,
    //    stale timestamp, bad HMAC) returns 400 with no body parsing. Mirrors
    //    the Stripe webhook's posture after sub-session 7's hardening.
    const signatureHeader = request.headers.get("calendly-webhook-signature");
    if (!verifyCalendlySignature(rawBody, signatureHeader, signingKey)) {
      console.warn("[calendly-webhook] signature verification failed");
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    // 4. Parse — only reachable past signature verification.
    let event: CalendlyEvent;
    try {
      event = JSON.parse(rawBody) as CalendlyEvent;
    } catch {
      console.warn("[calendly-webhook] body parse failed after valid signature");
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // 5. Dispatch. Unknown event types are intentionally 200/no-op — Calendly
    //    may send us subscribed events plus future-added ones; we shouldn't
    //    cause retries on events we deliberately don't care about.
    try {
      if (event.event === "invitee.created") {
        await handleInviteeCreated(event.payload);
      } else if (event.event === "invitee.canceled") {
        await handleInviteeCanceled(event.payload);
      } else {
        console.log(`[calendly-webhook] ignoring event=${event.event}`);
      }
    } catch (err) {
      console.error("[calendly-webhook] handler error:", err);
      return NextResponse.json({ error: "Handler failed" }, { status: 500 });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[calendly-webhook] unexpected error:", error);
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}

function verifyCalendlySignature(
  rawBody: string,
  signatureHeader: string | null,
  signingKey: string
): boolean {
  if (!signatureHeader) return false;

  // Format: "t=<unix_timestamp>,v1=<hex_hmac_sha256>"
  const parts: Record<string, string> = {};
  for (const segment of signatureHeader.split(",")) {
    const eqIdx = segment.indexOf("=");
    if (eqIdx === -1) continue;
    const key = segment.slice(0, eqIdx).trim();
    const value = segment.slice(eqIdx + 1).trim();
    if (key) parts[key] = value;
  }

  const timestamp = parts["t"];
  const expectedSig = parts["v1"];
  if (!timestamp || !expectedSig) return false;

  // Replay protection: reject signatures older than the configured window.
  const tsNumber = Number(timestamp);
  if (!Number.isFinite(tsNumber)) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - tsNumber);
  if (ageSeconds > SIGNATURE_MAX_AGE_SECONDS) return false;

  // HMAC-SHA256 over "<timestamp>.<raw_body>" with the signing key, hex.
  const signedPayload = `${timestamp}.${rawBody}`;
  const computed = crypto
    .createHmac("sha256", signingKey)
    .update(signedPayload)
    .digest("hex");

  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function handleInviteeCreated(payload: InviteePayload | undefined) {
  const utmContent = payload?.tracking?.utm_content;
  const scheduledFor = payload?.scheduled_event?.start_time;
  const eventUri = payload?.scheduled_event?.uri;
  const inviteeEmail = payload?.email;

  if (!utmContent) {
    console.warn(
      `[calendly-webhook] invitee.created missing utm_content (invitee=${inviteeEmail ?? "?"}); ignoring`
    );
    return;
  }
  if (!scheduledFor || !eventUri) {
    console.warn(
      `[calendly-webhook] invitee.created missing scheduled_event fields (utm_content=${utmContent}); ignoring`
    );
    return;
  }

  const clientId = Number(utmContent);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    console.warn(
      `[calendly-webhook] invitee.created utm_content="${utmContent}" not a valid client id; ignoring`
    );
    return;
  }

  // Verify the client exists before writing. Avoids creating orphan UPDATEs
  // on a deleted/invalid id and lets us log a useful diagnostic.
  const lookup = await pool.query(
    `SELECT id FROM clients WHERE id = $1`,
    [clientId]
  );
  if (lookup.rows.length === 0) {
    console.warn(
      `[calendly-webhook] invitee.created utm_content=${clientId} matched no client (invitee=${inviteeEmail ?? "?"}); ignoring`
    );
    return;
  }

  await pool.query(
    `UPDATE clients
     SET pro_call_booked_at = NOW(),
         pro_call_scheduled_for = $1,
         calendly_event_uri = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [scheduledFor, eventUri, clientId]
  );
  console.log(
    `[calendly-webhook] booking recorded: client=${clientId} call=${scheduledFor} invitee=${inviteeEmail ?? "?"}`
  );
}

async function handleInviteeCanceled(payload: InviteePayload | undefined) {
  const eventUri = payload?.scheduled_event?.uri;
  if (!eventUri) {
    console.warn(
      "[calendly-webhook] invitee.canceled missing scheduled_event.uri; ignoring"
    );
    return;
  }

  const result = await pool.query(
    `UPDATE clients
     SET pro_call_booked_at = NULL,
         pro_call_scheduled_for = NULL,
         calendly_event_uri = NULL,
         updated_at = NOW()
     WHERE calendly_event_uri = $1`,
    [eventUri]
  );
  if ((result.rowCount ?? 0) === 0) {
    console.warn(
      `[calendly-webhook] invitee.canceled for unknown event_uri=${eventUri}; no-op`
    );
  } else {
    console.log(
      `[calendly-webhook] booking cleared for event_uri=${eventUri}`
    );
  }
}
