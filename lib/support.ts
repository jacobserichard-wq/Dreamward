// lib/support.ts
//
// Single source of truth for the customer-support email shown to users
// (Help hub, getting-started guide, and any "contact support" CTA). Keep
// it in one place so the address never drifts across surfaces.
//
// This is a real, monitored inbox. The support@godreamward.com domain
// alias is not wired for inbound mail yet (improvmx-vs-resend decision
// still open — see ROADMAP §4), so support routes to the Gmail inbox.

export const SUPPORT_EMAIL = "Dreamwardsystems@gmail.com";
