const FROM_EMAIL = "FlowWork <hello@flowworks.it.com>";
const baseUrl = process.env.NEXTAUTH_URL ?? "https://flowworks.it.com";

interface EmailAttachment {
  /** Display filename — the CPA's mail client uses this on download. */
  filename: string;
  /** Base64-encoded file body. Resend's REST API decodes server-side. */
  content: string;
  /** Optional MIME hint. Resend will infer from the filename extension
   *  when omitted; passing it explicitly avoids ambiguity for .csv files
   *  served from text-typed routes. */
  contentType?: string;
}

interface EmailParams {
  to: string;
  subject: string;
  html: string;
  // Optional Reply-To header. Phase 6 (AR reminders) sets this to the
  // user's own email so customer replies thread back to the vendor,
  // not to FlowWork support.
  replyTo?: string;
  // Optional file attachments. Phase 7a (CPA handoff email) uses this
  // to deliver the annual CSV alongside the cover note. Resend caps
  // total attachment size at 40MB; FlowWork CSVs are < 1MB at v1 scale
  // so this isn't actively enforced here.
  attachments?: EmailAttachment[];
}

export async function sendEmail({
  to,
  subject,
  html,
  replyTo,
  attachments,
}: EmailParams) {
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
  if (attachments && attachments.length > 0) {
    // Resend's REST API expects `attachments: [{filename, content,
    // content_type?}]`. `content` is base64-encoded; the API decodes
    // before delivery. content_type is snake_case in the payload but
    // contentType camelCase in our internal shape (consistent with
    // the rest of EmailParams).
    payload.attachments = attachments.map((a) => {
      const out: Record<string, unknown> = {
        filename: a.filename,
        content: a.content,
      };
      if (a.contentType) out.content_type = a.contentType;
      return out;
    });
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

// Phase 7a (Tax Reports + CSV + CPA Handoff) commit 7 of 9. CPA
// handoff email template — short cover note that accompanies the
// annual CSV attachment. Tone: brief, professional, hands-off. The
// CPA's actual workflow happens in the attached CSV; this is just
// the cover letter.
//
// Reply-To = the user's own email (set in the route, not here) so
// the CPA's reply threads back to the vendor.
/**
 * Phase 12g daily COGS digest. Sent once per Pro merchant per day
 * when yesterday had at least one mapped line-item sale. Skip
 * threshold is in the cron handler (totalLineItemCount > 0) so
 * silent days don't spam inboxes.
 *
 * Tone: a quick, scannable "yesterday's pulse" — the kind of
 * thing a maker glances at over morning coffee. No call-to-action
 * unless there's actionable signal (unmatched items, underwater
 * SKUs).
 */
export function cogsDailyDigestEmail(opts: {
  businessName: string;
  date: string;          // YYYY-MM-DD that the digest is FOR
  revenue: number;
  cogs: number;
  margin: number;
  marginPercent: number | null;
  lineItemCount: number;
  unmatchedLineItemCount: number;
  underwaterSkuCount: number;
  topSku: { code: string; name: string; revenue: number } | null;
}) {
  const fmtUsd = (n: number) =>
    `$${n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const fmtPct = (n: number | null) =>
    n == null ? "—" : `${n.toFixed(1)}%`;
  const dateLabel = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(opts.date);
    if (!m) return opts.date;
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  })();

  const actionBlocks: string[] = [];
  if (opts.unmatchedLineItemCount > 0) {
    actionBlocks.push(`
      <p style="font-size: 14px; color: #92400e; background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; margin: 0 0 12px;">
        ⚠️ ${opts.unmatchedLineItemCount} line item${opts.unmatchedLineItemCount === 1 ? "" : "s"} arrived without a SKU mapping — your margin reading is incomplete until you map them.
        <a href="${baseUrl}/skus/unmatched" style="color: #92400e; font-weight: 600;">Map them →</a>
      </p>
    `);
  }
  if (opts.underwaterSkuCount > 0) {
    actionBlocks.push(`
      <p style="font-size: 14px; color: #991b1b; background: #fee2e2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; margin: 0 0 12px;">
        🚨 ${opts.underwaterSkuCount} SKU${opts.underwaterSkuCount === 1 ? "" : "s"} sold below cost yesterday.
        <a href="${baseUrl}/cogs" style="color: #991b1b; font-weight: 600;">Review →</a>
      </p>
    `);
  }
  const topSkuBlock = opts.topSku
    ? `
      <p style="font-size: 14px; color: #475569; line-height: 1.5; margin: 16px 0 0;">
        Top earner: <strong style="font-family: ui-monospace, monospace;">${opts.topSku.code}</strong> ${opts.topSku.name} — ${fmtUsd(opts.topSku.revenue)}
      </p>
    `
    : "";

  return {
    subject: `${opts.businessName || "FlowWork"} — ${dateLabel}: ${fmtUsd(opts.revenue)} sold, ${fmtPct(opts.marginPercent)} margin`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
        <p style="font-size: 12px; color: #94a3b8; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.05em;">
          Daily pulse — ${dateLabel}
        </p>
        <h1 style="font-size: 22px; color: #0f172a; margin: 0 0 20px;">
          ${opts.businessName || "Your business"} — yesterday in numbers
        </h1>

        <table style="width: 100%; border-collapse: separate; border-spacing: 8px 0; margin: 0 0 16px;">
          <tr>
            <td style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; vertical-align: top; width: 33%;">
              <p style="font-size: 10px; color: #64748b; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.05em;">Revenue</p>
              <p style="font-size: 18px; color: #0f172a; margin: 0; font-weight: 700;">${fmtUsd(opts.revenue)}</p>
            </td>
            <td style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; vertical-align: top; width: 33%;">
              <p style="font-size: 10px; color: #64748b; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.05em;">COGS</p>
              <p style="font-size: 18px; color: #475569; margin: 0; font-weight: 700;">${fmtUsd(opts.cogs)}</p>
            </td>
            <td style="background: #ecfdf5; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; vertical-align: top; width: 33%;">
              <p style="font-size: 10px; color: #047857; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.05em;">Margin</p>
              <p style="font-size: 18px; color: #065f46; margin: 0; font-weight: 700;">${fmtUsd(opts.margin)}</p>
              <p style="font-size: 11px; color: #047857; margin: 2px 0 0;">${fmtPct(opts.marginPercent)} of revenue</p>
            </td>
          </tr>
        </table>

        <p style="font-size: 13px; color: #64748b; margin: 0 0 16px;">
          ${opts.lineItemCount} line item${opts.lineItemCount === 1 ? "" : "s"} sold.
        </p>

        ${actionBlocks.join("")}

        <a href="${baseUrl}/cogs" style="display: inline-block; padding: 10px 20px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 8px 0 0;">
          Open full COGS dashboard →
        </a>

        ${topSkuBlock}

        <p style="font-size: 11px; color: #cbd5e1; margin: 32px 0 0; border-top: 1px solid #f1f5f9; padding-top: 16px;">
          You receive this once a day on days you have mapped sales. To stop these, reply with "unsubscribe" and we'll handle it.
        </p>
      </div>
    `,
  };
}

export function cpaAnnualSummaryEmail(opts: {
  businessName: string;        // clients.business_name
  userFirstName: string;       // best-effort first name; falls back to business
  year: number;
  netProfit: number;
  // Phase 13: when grossProfit is provided AND the business had
  // non-zero COGS, the email's headline paragraph adds a
  // gross-profit line above net profit so the CPA sees both
  // figures up front.
  grossProfit?: number;
  cogs?: number;
}) {
  const { businessName, userFirstName, year, netProfit, grossProfit, cogs } = opts;
  const fmt = (n: number) =>
    `$${n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const formattedNet = fmt(netProfit);
  const formattedGross = grossProfit != null ? fmt(grossProfit) : null;
  const formattedCogs = cogs != null ? fmt(cogs) : null;
  const showGross = (cogs ?? 0) > 0 && formattedGross !== null;
  const signoff = userFirstName.trim() || businessName;

  return {
    subject: `${businessName} — Tax Year ${year} Summary`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px;">
        <h1 style="font-size: 22px; color: #0f172a; margin: 0 0 16px;">${year} Business Summary</h1>
        <p style="font-size: 16px; color: #334155; line-height: 1.6; margin: 0 0 16px;">
          Hi,
        </p>
        <p style="font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 16px;">
          Attached is my ${year} business summary from FlowWork for ${businessName},
          in two formats:
        </p>
        <ul style="font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 16px; padding-left: 20px;">
          <li><strong>PDF</strong> — printable single-page summary for filing /
            review.</li>
          <li><strong>CSV</strong> — full transaction ledger broken into
            Summary, Income, Expense, and Mileage sections. Filter by the
            <strong>Section</strong> column in Excel or Sheets to isolate each.</li>
        </ul>
        ${showGross ? `
        <p style="font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 8px;">
          Gross profit: <strong>${formattedGross}</strong> (revenue minus
          ${formattedCogs} cost of goods).
        </p>
        ` : ""}
        <p style="font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 16px;">
          ${showGross ? "Net" : "Headline number for " + year + ":"} <strong>${formattedNet}</strong>${showGross ? " net profit" : " net profit"}
          (cash basis).
        </p>
        <p style="font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 24px;">
          Reply to this email with any questions — replies route directly to me.
        </p>
        <p style="font-size: 15px; color: #334155; line-height: 1.6; margin: 0 0 4px;">Thanks,</p>
        <p style="font-size: 15px; color: #334155; line-height: 1.6; margin: 0 0 24px;">${signoff}</p>
        <p style="font-size: 12px; color: #94a3b8; margin: 32px 0 0;">
          Sent via FlowWork. Cash-basis reports — income counted when
          received, expenses when paid. Verify against source documents
          before filing.
        </p>
      </div>
    `,
  };
}