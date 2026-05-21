const FROM_EMAIL = "FlowWork <hello@flowworks.it.com>";
const baseUrl = process.env.NEXTAUTH_URL ?? "https://flowworks.it.com";

interface EmailParams {
  to: string;
  subject: string;
  html: string;
  // Optional Reply-To header. Phase 6 (AR reminders) sets this to the
  // user's own email so customer replies thread back to the vendor,
  // not to FlowWork support.
  replyTo?: string;
}

export async function sendEmail({ to, subject, html, replyTo }: EmailParams) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY not configured");
  }

  const payload: Record<string, unknown> = {
    from: FROM_EMAIL,
    to,
    subject,
    html,
  };
  if (replyTo) {
    // Resend's REST API uses `reply_to` (snake_case) — accepts string or
    // array. We pass the single user email through.
    payload.reply_to = replyTo;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (data && typeof data === "object" && "message" in data && (data as { message?: string }).message) ||
      `HTTP ${res.status}`;
    throw new Error(`Resend send failed: ${detail}`);
  }
  return data;
}

export function welcomeEmail(businessName: string) {
  return {
    subject: "Welcome to FlowWork!",
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px;">
        <h1 style="font-size: 24px; color: #0f172a; margin: 0 0 16px;">Welcome to FlowWork!</h1>
        <p style="font-size: 16px; color: #334155; line-height: 1.6; margin: 0 0 24px;">
          Hey ${businessName || "there"}, your account is set up and ready to go.
        </p>
        <p style="font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 12px;">Here is how to get started:</p>
        <ol style="font-size: 15px; color: #475569; line-height: 1.8; padding-left: 20px; margin: 0 0 24px;">
          <li>Connect your Gmail to start pulling invoices</li>
          <li>Click Process with AI to extract data automatically</li>
          <li>Review, approve, and track everything from your dashboard</li>
        </ol>
        <a href="${baseUrl}" style="display: inline-block; padding: 12px 28px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">Open FlowWork</a>
        <p style="font-size: 13px; color: #94a3b8; margin: 32px 0 0;">You have a 14-day free trial. No credit card required.</p>
      </div>
    `,
  };
}

export function trialExpiringEmail(businessName: string, daysLeft: number) {
  return {
    subject: "Your FlowWork trial expires in " + daysLeft + " day" + (daysLeft === 1 ? "" : "s"),
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px;">
        <h1 style="font-size: 24px; color: #0f172a; margin: 0 0 16px;">Your trial is ending soon</h1>
        <p style="font-size: 16px; color: #334155; line-height: 1.6; margin: 0 0 24px;">
          Hey ${businessName || "there"}, your FlowWork trial expires in <strong>${daysLeft} day${daysLeft === 1 ? "" : "s"}</strong>.
          Upgrade now to keep your data and continue automating your accounting.
        </p>
        <p style="font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 24px;">Plans start at just $19/month.</p>
        <a href="${baseUrl}/billing" style="display: inline-block; padding: 12px 28px; background: #16a34a; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">View Plans</a>
        <p style="font-size: 13px; color: #94a3b8; margin: 32px 0 0;">Questions? Just reply to this email.</p>
      </div>
    `,
  };
}

export function proCallReminderEmail(businessName: string) {
  return {
    subject: "Book your FlowWork Pro onboarding call",
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px;">
        <h1 style="font-size: 24px; color: #0f172a; margin: 0 0 16px;">Your Pro onboarding call is waiting</h1>
        <p style="font-size: 16px; color: #334155; line-height: 1.6; margin: 0 0 24px;">
          Hey ${businessName || "there"}, your FlowWork Pro plan includes a complimentary 30-minute onboarding call —
          we'll configure FlowWork around your specific workflow, accounting software, and tax situation.
        </p>
        <p style="font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 24px;">
          Pick a time that works — we'll send a calendar invite with the meeting link.
        </p>
        <a href="${baseUrl}/welcome-pro" style="display: inline-block; padding: 12px 28px; background: #d97706; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">Book your call</a>
        <p style="font-size: 13px; color: #94a3b8; margin: 32px 0 0;">Questions? Just reply to this email.</p>
      </div>
    `,
  };
}

export function paymentFailedEmail(businessName: string) {
  return {
    subject: "FlowWork: Payment failed - action needed",
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px;">
        <h1 style="font-size: 24px; color: #0f172a; margin: 0 0 16px;">Payment failed</h1>
        <p style="font-size: 16px; color: #334155; line-height: 1.6; margin: 0 0 24px;">
          Hey ${businessName || "there"}, we were unable to process your latest payment for FlowWork.
          Please update your payment method to avoid any interruption to your service.
        </p>
        <a href="${baseUrl}/billing" style="display: inline-block; padding: 12px 28px; background: #dc2626; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">Update Payment</a>
        <p style="font-size: 13px; color: #94a3b8; margin: 32px 0 0;">If you believe this is an error, please reply to this email.</p>
      </div>
    `,
  };
}

// Phase 6 AR follow-up reminder. Polite-but-firm tone — design §7.
// Sent via Resend with Reply-To = the FlowWork user's own email so
// the customer's reply threads back to the vendor, not to FlowWork.
//
// Subject + body adapt based on whether the invoice is overdue:
//   - daysOverdue > 0 → "Friendly reminder" subject, "X days ago" body
//   - daysOverdue ≤ 0 → "A note" subject (gentle nudge before due)
//
// The user is NOT shown a preview/edit step in v1 (design §7). Tap
// Send → email goes. Edit-before-send is a v1.5 candidate.
export function arReminderEmail(opts: {
  businessName: string;             // sender's business (clients.business_name)
  customerName: string;             // recipient (invoices.customer_name)
  invoiceNumber: string | null;     // invoices.invoice_number, may be null
  amountOutstanding: number;        // amount_total - amount_paid
  dueDate: string;                  // YYYY-MM-DD
  daysOverdue: number;              // may be 0 or negative (gentle nudge mode)
}) {
  const {
    businessName,
    customerName,
    invoiceNumber,
    amountOutstanding,
    dueDate,
    daysOverdue,
  } = opts;

  const invoiceRef = invoiceNumber ? `invoice #${invoiceNumber}` : "your invoice";
  const formattedAmount = `$${amountOutstanding.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  const overdueLine =
    daysOverdue > 0
      ? `That's ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} ago.`
      : "It's due soon.";
  const firstName = customerName.split(" ")[0] || customerName;

  return {
    subject:
      daysOverdue > 0
        ? `Friendly reminder: ${invoiceRef} from ${businessName}`
        : `A note on ${invoiceRef} from ${businessName}`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px;">
        <h1 style="font-size: 22px; color: #0f172a; margin: 0 0 16px;">A note about ${invoiceRef}</h1>
        <p style="font-size: 16px; color: #334155; line-height: 1.6; margin: 0 0 16px;">
          Hi ${firstName},
        </p>
        <p style="font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 16px;">
          Hope you're well. This is a friendly reminder that ${invoiceRef}, for
          <strong>${formattedAmount}</strong>, was due on <strong>${dueDate}</strong>.
          ${overdueLine} If it's already on the way, please ignore this note.
        </p>
        <p style="font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 24px;">
          Otherwise, you can reply to this email and I'll be happy to help.
        </p>
        <p style="font-size: 15px; color: #334155; line-height: 1.6; margin: 0 0 4px;">Thanks,</p>
        <p style="font-size: 15px; color: #334155; line-height: 1.6; margin: 0 0 24px;">${businessName}</p>
        <p style="font-size: 12px; color: #94a3b8; margin: 32px 0 0;">
          Sent via FlowWork. Reply directly to reach ${businessName}.
        </p>
      </div>
    `,
  };
}