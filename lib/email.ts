const FROM_EMAIL = "FlowWork <hello@flowworks.it.com>";

interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: EmailParams) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  console.log("Attempting to send email to:", to, "API key exists:", !!RESEND_API_KEY);
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY not configured");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
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
        <a href="https://flow-work-khaki.vercel.app" style="display: inline-block; padding: 12px 28px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">Open FlowWork</a>
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
        <a href="https://flow-work-khaki.vercel.app/billing" style="display: inline-block; padding: 12px 28px; background: #16a34a; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">View Plans</a>
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
        <a href="https://flow-work-khaki.vercel.app/billing" style="display: inline-block; padding: 12px 28px; background: #dc2626; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">Update Payment</a>
        <p style="font-size: 13px; color: #94a3b8; margin: 32px 0 0;">If you believe this is an error, please reply to this email.</p>
      </div>
    `,
  };
}