# FlowWork Product Roadmap

**Small Business Edition** | Updated May 8, 2026

**8 Phases** · **55+ Tasks** · **17 Weeks** · **Phase 0–1 SHIPPED** · **Phase 1.5 SHIPPED** · **Phase 1.6 IN PROGRESS (OAuth submission paused — CASA decision)** · **Phase 1.7 SHIPPED (white-glove Tier 1)** · **Phase 2: 3/6 + signin mobile-responsive shipped, dashboard pending**

---

## UX Principles

FlowWork uses standard accounting vocabulary (AR aging, expense categories, mileage, Schedule C). Our customers include bookkeepers and small CPA firms who expect that language. But the *experience* is built for someone who has never used accounting software before.

Every Phase 2+ feature gets reviewed against these principles before it merges:

1. **Sensible defaults beat decisions.** Pre-fill the most common answer. Users override only when needed.
2. **One primary action per screen.** The thing 90% of users came to do is the obvious big button. Secondary actions are visible but visually demoted.
3. **No dead ends.** Every empty state has a clear next step. Never just "No data yet" — always "Connect your Gmail to see your first invoice."
4. **Errors tell users what to do.** Not just what went wrong.
5. **Mobile-first interactions.** Every flow works one-handed on a phone.
6. **Progressive disclosure.** Power-user details (raw transaction logs, category overrides, audit trails) are accessible but tucked behind expandable sections. Bookkeepers can find them; side-hustlers don't trip over them.
7. **Visible feedback.** Every action gets immediate response — spinner, toast, confirmation. Never let the user wonder "did that work?"
8. **Forgiving inputs.** No required fields you don't strictly need. Accept whatever date/number format the user typed.

**The test:** A craft seller at a market should be able to log a sale, snap a receipt, and check their monthly profit without ever asking "where do I click?"

---

## Phase 0 — Multi-Tenancy & Payments — SHIPPED

**Week 1–3** | Multi-client SaaS platform with paid subscriptions

- [x] Create `clients` table (client_id, business_name, email, plan, industry) — *backend*
- [x] Add `client_id` foreign key to `processed_items` and all future tables — *backend*
- [x] Scope all DB queries by `client_id` — *backend*
- [x] Auto-create client record on first Google OAuth sign-in — *backend*
- [x] Client settings table (active_modules, custom_categories, preferences) — *backend*
- [x] Stripe integration — Checkout for subscriptions, webhook for plan changes — *payments*
- [x] Three pricing tiers: Starter ($19/mo), Growth ($49/mo), Pro ($89/mo) — *payments*
- [x] 14-day free trial flow — no credit card required — *payments*
- [x] Plan-gated features — check `client.plan` before rendering modules — *backend*
- [x] Billing settings page — current plan, usage stats, upgrade/downgrade — *feature*

---

## Phase 1 — Admin & Client Management — SHIPPED

**Week 4–5** | Internal tools, onboarding, data migration, white-glove Pro tier

- [x] Add `source` field to `processed_items` (email, csv_import, manual, sample) — *backend*
- [x] Onboarding flow — welcome screen, business name, industry — *UX*
- [x] Admin dashboard — list all clients with plan, status, joined date — *feature*
- [x] Client detail view — see their data, settings, and activity — *feature*
- [x] Usage tracking — items processed per month, scoped by client — *backend*
- [x] Module toggle UI — enable/disable features per client — *feature*
- [x] Custom expense categories — clients can add/edit their own — *feature*
- [x] Email notifications — welcome, payment-failed (Resend) — *infra*
- [x] CSV upload with Claude auto-mapping columns — *feature*
- [x] QuickBooks/Xero/Wave export hints (LLM-prompt based) — *feature*
- [x] Email history backfill — selectable date range (30/60/90/180/365 days) — *feature*
- [x] White-glove onboarding for Pro tier (Calendly + industry sample data) — *feature*

### Known limitations from May 5 audit (deferred to Phase 1.5 or later)

These items are functionally working but flagged as partial during a code-level audit on May 5. None are launch-blocking, but each should be addressed before the product is exposed to a wide customer base:

- **No XLSX support** — only `.csv` and `.tsv` parse. Marketing claim says "CSV/Excel." Add `xlsx` package and dual-handler routing.
- **QB/Xero/Wave parser is LLM prompt hints, not code** — works for clean exports, fragile on edge cases (column renames, locale-specific dates). Document as known limitation; consider deterministic format detection in a later phase.
- **No `last_login` column** — admin dashboard shows joined date instead. Add column + populate on auth callback.
- **`manual` source value not used** — schema supports it, no insert path sets it. Either future-proofing or dead code.
- **Backfill range not enforced server-side** — UI clamps to 30/60/90/180/365 days, but API accepts arbitrary `after` param. Low-risk; `maxResults` ceiling at 100 limits damage.
- **Stripe init crashes local builds** — `lib/stripe.ts` instantiates client at module load; `.env.local` lacks the key. Lazy-init the Stripe client to fix local dev.
- **Onboarding doesn't have explicit "Connect Gmail" step** — Gmail scopes are bundled into NextAuth sign-in. Functionally correct; update marketing copy to match reality, or split for explicitness.

---

## Phase 1.5 — Cleanup & Auth UI — IN PROGRESS

**Week 5.5** | Real defects from the Phase 1 audit + missing auth UI surface

These three fixes already shipped from the May 5 audit:

- [x] **Trial-expiring email cron schedule** — `vercel.json` added with daily cron at `/api/cron`. Without this, no trial-expiring emails ever fired.
- [x] **Custom categories field-name mismatch** — `app/api/upload/route.ts` was reading `expense_categories`; `/api/settings` writes to `custom_categories`. Pro customers' custom categories never reached Claude during CSV mapping. Renamed.
- [x] **Admin allowlist hardcoded** — replaced hardcoded `meridian.supply.test@gmail.com` with `ADMIN_EMAILS` env var. Both launch blocker and security issue.

Auth UI also shipped in this phase:

- [x] **Sign-in page** at `/signin` — single "Sign in with Google" button, clean white styling. NextAuth-backed, supports `?callbackUrl=` to preserve original destination. — *UX*
- [x] **Logout link** in shared layout — top-right, plain text "Sign out," calls `signOut({ callbackUrl: '/signin' })`. `prompt=select_account` shows Google's account chooser for fast multi-account dev testing. — *UX*
- [x] **Route-protection middleware (`proxy.ts` in Next 16)** — explicit allowlist: protected routes redirect anonymous users to `/signin`. Public routes intentionally exempt: `/signin`, `/api/auth/*`, `/api/test-email`, `/api/cron`, `/api/stripe/webhook`, `/privacy`, `/terms`. — *backend*

**Why this is a phase, not a bug fix:** The audit found three real defects (above) plus zero auth UI. Without sign-in/logout/middleware, anonymous users see a broken dashboard, and account switching requires incognito windows. Both block real Phase 2 testing and any meaningful customer onboarding. Carving this out kept Phase 2 scope focused on its three remaining items.

---

## Phase 1.6 — Launch Prep — IN PROGRESS

**Week 5.7** | Custom domain, public legal pages, OAuth submission groundwork

- [x] **Custom domain `flowworks.it.com` connected** — Vercel A record (216.198.79.1), DNS propagated, SSL provisioned. Both apex and `www.flowworks.it.com` (via redirect) live. *Existing Resend TXT records preserved.* — *infra*
- [x] **NextAuth + Google OAuth migrated to custom domain** — `NEXTAUTH_URL` updated, Google Cloud OAuth client now lists `flowworks.it.com` in both Authorized JavaScript origins and Authorized redirect URIs. Old vercel.app entries kept for transition. — *infra*
- [x] **Privacy policy live** at `flowworks.it.com/privacy` — covers Google Limited Use commitment, subprocessor transparency, deletion mechanism, AI processing disclosure. Honest disclosure of `gmail.readonly` scope grant vs. application-level limited use (added May 5 after audit). — *legal*
- [x] **Terms of service live** at `flowworks.it.com/terms` — 14-day money-back guarantee, "not an accounting firm" disclaimer, Indiana governing law, $100 / 12-month liability cap. — *legal*
- [x] **Branding finalized in Google Auth Platform** — app name, lightning bolt logo (120×120 PNG), authorized domains, support email all set. — *infra*
- [ ] **OAuth Production submission** — **PAUSED — see CASA blocker below.**

### Strategic decision: Tiered auth model (May 5, 2026, late session)

After surfacing the CASA blocker, the founder pivoted from "submit OAuth Production now" to a tiered auth strategy that matches FlowWork's actual customer mix and de-risks the CASA spend with real revenue data.

**The model:**

| Tier | Price | Auth method | Data input | Google OAuth? |
|---|---|---|---|---|
| **Starter** | $19/mo | Email magic-link | CSV upload only | No — unlimited users |
| **Growth** | $49/mo | Email magic-link | CSV upload only | No — unlimited users |
| **Pro** | $89/mo | Google sign-in + Gmail integration | Gmail auto-fetch + CSV | Yes — capped at 100 until CASA |

**Why this works:**

1. **Matches real customer behavior.** Farmer's market vendors, craft sellers, food trucks live in Square / Stripe / cash logs — they need CSV upload, not Gmail-fetch. Bookkeepers, freelancers handling B2B email, and small CPA firms benefit most from Gmail auto-fetch — those become Pro-tier.
2. **Justifies the $40/mo gap between Growth and Pro.** "Connect your Gmail and never lift a finger" is a genuinely-different value prop than "more accounts + tax reports."
3. **Turns the 100-user OAuth cap into a market-validation tool.** If 50+ users actively pay for the Pro tier specifically because of Gmail integration, that's $4,450/mo recurring proving the CASA spend is justified. If only ~10 users upgrade to Pro and the rest stay on Starter/Growth, the data says don't spend on CASA — invest elsewhere.
4. **Aligns with iPhone-easy principle.** CSV becomes the primary onboarding path; Gmail is the power-user upsell. New users never hit OAuth complexity in their first 30 seconds with the product.
5. **Marketing channels (farmer's markets, Instagram, word-of-mouth) work cleanly under this model.** The 90-second booth pitch is "scan QR → upload your Square CSV → see your profit." No Google grant-flow at the demo table.

**CASA decision criteria (revisit when one of these triggers):**
- 50+ active Pro-tier subscribers, OR
- Clear demand signal in customer interviews (e.g., 5+ prospects say they'd pay if Gmail integration existed but won't pay without it), OR
- Pro tier starts hitting the 100-user cap

Until then: the OAuth Production submission stays paused, the app stays in Testing mode for the Pro tier only, and Starter/Growth grow without that constraint.

### Implementation tasks (deferred, not blocking Phase 2)

These changes implement the tiered model. None are required to ship Phase 2 mobile-responsive or AI auto-classification — those phases work fine on the current architecture. Schedule these when ready to launch publicly:

- [ ] **Add NextAuth Email provider** (magic-link via Resend, which is already wired up). Required for Starter/Growth signup without Google. — *backend*, ~3–4 hours
- [ ] **Plan-gate Gmail OAuth scope request.** Currently requested at sign-in for everyone; should only be requested when a Pro-tier user explicitly clicks "Connect Gmail" in settings. — *backend*, ~2–3 hours
- [ ] **Fork onboarding flow.** New signup → "Email or Google?" choice → email path goes to plan picker (Starter / Growth / Pro) → Google path implies Pro. — *UX*, ~2–4 hours
- [ ] **Update marketing copy.** Pricing page should make clear: CSV upload available on all tiers; Gmail auto-fetch is Pro-only. Avoids surprising customers who upgrade expecting Gmail and don't realize it's plan-gated. — *content*, ~1 hour
- [ ] **CSV-first quickstart for Starter/Growth.** New empty-state for non-Gmail users: "Upload your first CSV from Square / Stripe / QuickBooks" with provider-specific guidance. — *UX*, ~2–3 hours

**Total deferred work:** ~10–14 hours across 5 tasks. Suggested ordering when revisited: Email provider → plan gate → onboarding fork → CSV quickstart → marketing copy.

### CASA blocker reference (kept for future revisit)

A code-level audit on May 5 confirmed FlowWork requests `gmail.readonly`, which is a **Restricted scope** under Google's classification. Restricted scopes require a [CASA (Cloud Application Security Assessment)](https://cloud.google.com/security/products/security-command-center/casa) by an approved third-party auditor before production verification can proceed.

- **CASA cost:** $4,000–$15,000 depending on assigned tier
- **CASA timeline:** 4–8 weeks of audit, on top of 2–6 weeks of OAuth review
- **Without CASA:** Google caps the app at 100 lifetime test users in Testing mode. Under the new tiered auth model, this only constrains Pro-tier signups, not Starter/Growth.

When CASA is committed: get bids from at least 3 approved auditors before signing.

---

## Phase 1.7 — White-Glove Audit & Tier 1 Fixes — SHIPPED

**Week 5.8** (May 6, 2026) | Audit of the Phase 1 white-glove implementation; ship the most embarrassing fixes; defer the rest with explicit reasoning.

### Why this is a phase

The white-glove onboarding for Pro tier was checked off in Phase 1 because the components existed: a `/welcome-pro` page, hardcoded Calendly link, sample data preloader, and four "benefit" cards covering the marketing promises. A code-level audit on May 6 revealed that the implementation, while functional in isolation, had real gaps that would embarrass us in front of a paying customer. Carving out a focused phase lets the original Phase 1 entry stay accurate ("v1 shipped") while documenting what came after.

### Audit findings (top embarrassments)

1. **A new Pro signup never sees `/welcome-pro`.** Stripe checkout success_url routed everyone to `/`, regardless of plan. The page was reachable only by typing the URL directly or via a settings re-run path. The most-marketed feature was orphaned.
2. **No Calendly webhook → no booking signal.** A Pro customer could pay $89/mo, book a slot, and we'd have zero record of it in our DB. Confirmation lived only in the founder's personal Gmail.
3. **"Priority support, 24-hour SLA" had no backing infrastructure.** No flagged inbox, no queue, no routing. Pro support emails went to the same inbox as trial users.
4. **6 of 11 industries got identical generic sample data.** Landscaping, real estate investors, Etsy sellers, personal trainers, bookkeepers, and nonprofits all saw the same Office Depot / Comcast / Costco rows.
5. **No reminder if a Pro customer never books.** The trial-expiring cron filtered to `plan = 'trial'` only — Pro users who paid and ignored the welcome page got no nudge.

### Tier 1 — SHIPPED today

These are the cheap, high-impact fixes. Three commits, one schema migration, all live in production:

- [x] **Calendly URL via env var** — `NEXT_PUBLIC_CALENDLY_URL` with hardcoded fallback. Configurable without code change. — *infra*, commit `6789e2c`
- [x] **Calendly URL prefilled with client identity** — `email`, `name`, `utm_source=flowwork`, `utm_content=<client_id>`. Eventual webhook will use `utm_content` to correlate bookings to FlowWork clients. — *feature*, commit `1e3f42d`
- [x] **Pro Stripe checkout success_url → `/welcome-pro`** — Starter and Growth still go to `/`. Branch keyed on `planId === 'pro'` (no priceId hardcoded). — *backend*, commit `ba91a32`
- [x] **Backstop banner on dashboard** — Yellow "Welcome to Pro!" banner shows for Pro users where `welcome_pro_seen = false`. Links to `/welcome-pro` via Next.js client-side routing. — *UX*, commit `ba91a32`
- [x] **`welcome_pro_seen` column added to `clients` table** — Boolean, NOT NULL, DEFAULT false. Migration applied to Railway production. — *backend*
- [x] **`/api/welcome-pro/seen` POST endpoint** — Fires once per page visit via `useRef` guard, fire-and-forget, flips the flag. Banner clears on next dashboard load. — *backend*, commit `ba91a32`

### Tier 2 — DEFERRED (next white-glove session)

Real work, real customer impact. Schedule when ready:

- [ ] **Calendly webhook** — `/api/webhooks/calendly` route. On `invitee.created`, look up the client via `utm_content`, write `pro_call_booked_at` timestamp. Banner copy upgrades from "Book your call" to "Your call is on Friday at 2pm." ~2–4 hours.
- [ ] **Sample data parity** — Tailored sample data for the 6 missing industries: landscaping/service, real estate, e-commerce, creative photography, bookkeeper, nonprofit, fitness. Each ~12 realistic vendor rows. ~1–2 hours.
- [ ] **Pro-specific "haven't booked yet" reminder cron** — Extend `/api/cron` to find Pro clients where `pro_call_booked_at IS NULL` and signup was 3+ days ago. New `proOnboardingReminderEmail` template. ~1–2 hours.

### Tier 3 — STRATEGIC (think before building)

These need product/business decisions, not just code:

- [ ] **Admin tooling to track call completion + assist during call** — Currently no admin UI to mark a call complete or edit a client's settings on their behalf. Recommended approach: simple admin checklist UI (tick boxes during the call), not a full mutation API. The customer still does their own settings edits. ~4–6 hours.
- [ ] **"Priority support, 24-hour SLA" — Option A or Option B**
  - **Option A (keep the promise):** Build infrastructure — Resend tag for Pro support emails, Slack webhook ping, founder commits to 24h response personally. Personal-time commitment, not just code.
  - **Option B (soften the marketing):** Change copy to "priority email support" without an explicit SLA. Cheaper, less differentiating.
  - This is a Richard decision before scaling past ~10 Pro customers.

### Tier 4 — DEFER (real but cosmetic)

- [ ] Pro→Growth downgrade cleanup — `welcome_pro_seen` and sample-data rows persist after downgrade. Fix when there's a real downgrade in the data, not before.
- [ ] Production validation tasks — verify Calendly link still resolves, confirm `STRIPE_WEBHOOK_SECRET` is set in Vercel. Periodic checks, not feature work.

### What's still honest in the marketing

After Tier 1, the welcome page promises that match real infrastructure: 1:1 onboarding call (Calendly works, link is correlatable), custom categories (the page advertises this — actual editing happens in the customer's own settings during the call), tax-ready reports (Phase 7 will deliver these — for now this is forward-looking).

What's still aspirational: "Direct line to our team. Most questions answered same-day, guaranteed under 24 hours." See Tier 3 Option A vs. Option B.

---

## Phase 2 — Foundation Polish — 3/6 IN PROGRESS

**Week 6–7** | Make the app demo-ready for paying clients

- [x] Fix stray `//` in JSX — *bug*
- [x] Improve error messages (show actual error text + endpoint + status) — *UX*
- [x] Add loading spinners during email fetch and AI processing — *UX*
- [ ] **Mobile-responsive layout** for on-the-go use — *UX* (in progress — see sub-section below)
  - UX considerations: Phone-first design, not just "scaled down desktop." Header collapses to hamburger; primary actions accessible by thumb in the bottom third of the screen; tables become cards on narrow viewports.
- [ ] **Publish Google Cloud OAuth app to Production mode** — *infra*
  - **Blocked on CASA decision (see Phase 1.6 above).** App can run in Testing mode (capped at 100 users) until CASA is committed.
- [ ] **AI auto-classification** — scan inbox, auto-label emails — *AI*
  - UX considerations: Confidence threshold for auto-apply vs. ask. Always show a "review" surface so users can correct mistakes; corrections feed back into the prompt or fine-tune.

### Mobile-responsive progress (May 6, 2026, evening session)

**Architectural decision:** Tailwind v4 was already installed but unused. After a read-only audit of styling architecture (inline `style` objects everywhere, zero responsive logic, `globals.css` already importing Tailwind), the choice was Option C — adopt Tailwind utility classes for new and touched components. Reasons: zero new dependency, no JS runtime cost, no SSR hydration risk, scannable utilities, design tokens in `@theme`. Mixed-system burden bounded because each file is either fully inline or fully Tailwind — never both. The `s`/`st`/`styles` const at the bottom of a file is the visible signal of "this one's still inline."

**Pattern (reproducible):**
1. Audit the file — list every hex color and map to slate (or red/amber/etc.) tokens.
2. Smoke test — add one utility class with visible effect (e.g., `outline outline-2 outline-red-500`) and deploy. Verify Tailwind JIT picks up the file before doing the full conversion.
3. Convert — replace `s` const with `className` strings, mobile-first responsive (`p-3 sm:p-6` etc.).
4. Verify on Vercel preview at 320px, 390px, and desktop. Inspect DOM to confirm `style={...}` removed and Tailwind classes applied.
5. Stop after each commit. One file per commit until the pattern is fully proven.

**Shipped May 6 (evening):**
- [x] **Tailwind v4 smoke test** — verified JIT scans `app/**/*.tsx` correctly. Commit `23221eb`. — *infra*
- [x] **Signin page migrated to Tailwind** — first responsive page in the app. 22 lines of utilities replacing 91 lines of inline styles. Mobile-first padding (`p-3 sm:p-6` container, `py-8 px-6 sm:py-11 sm:px-10` card). Verified at 320px, 375px, 390px, and desktop. Commit `009a5a8`. — *UX*

**Shipped May 7 (sub-session 1 + sub-session 2):**
- [x] **PolicyDocument migrated to Tailwind** — both `/privacy` and `/terms` benefit from one conversion. 18 element types, list-marker preflight gotcha caught and fixed. Commit `ee388d2`. — *UX*
- [x] **PageHeader component extracted** at `app/components/PageHeader.tsx` — server component, accepts `backHref`, `backLabel`, `title`, `subtitle?`, `rightSlot?`. Replaces the back-link + title + subtitle pattern duplicated across 4 pages. Commit `949bdab`. — *infra*
- [x] **planColor helper extracted** at `lib/planColor.ts` — Tailwind class strings for plan-badge colors. Reused by admin and admin/client. Commit `3ba4e59`. — *infra*
- [x] **Billing migrated to Tailwind** with PageHeader as first consumer. Plan-comparison grid, conditional className composition, dynamic-width usage bar (kept inline as runtime value). Commit `949bdab`. — *UX*
- [x] **Settings migrated to Tailwind** with PageHeader. Module toggle cards with three-state conditional className composition. Commit `3a31a23`. — *UX*
- [x] **Admin migrated to Tailwind** with PageHeader. 8-column data table preserved with overflow-x-auto wrapper (intrinsic horizontal scroll on the table, not a regression). Commit `3ba4e59`. — *UX*
- [x] **Admin/client migrated to Tailwind** with PageHeader's rightSlot for the plan badge. First rightSlot consumer; validated component composition. Commit `79bbc62`. — *UX*

**Shipped May 8 (sub-session 3):**
- [x] **Stripe webhook fix** — `clients.plan` now correctly derived from subscription event's priceId, not hardcoded `'starter'` in checkout. Two-line surgical fix. Customer-facing bug — affected at least one test client; detection query confirmed no other DB rows in the wrong state at time of fix. Commit `0f06660`. — *bug*
- [x] **Welcome-pro migrated to Tailwind** — first non-light-theme migration. Dark gradient hero (`bg-gradient-to-br from-slate-800 to-slate-700`), PRO badge gradient (`from-amber-500 to-amber-600`), 4-card responsive grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`), Calendly inline widget preserved (`calendly-inline-widget` class + `data-url` attribute intact). Container kept at 1100px (welcome-pro exception, like dashboard's top bar) to preserve 4-card desktop layout — flagged but justified. Verified at desktop / 375px / 390px. Commit `6c56a38`. — *UX*

**Discovered May 6 (not in original Phase 2 scope, but real):**
- **Brand mark / header is duplicated across 4–5 pages** (dashboard, welcome-pro, billing, settings, admin). Each rebuilds the FlowWork logo + sign-out independently. Phase 2 mobile work without a shared header means every page rewrites the hamburger logic separately. **Header centralization should happen *before* dashboard mobile work, not after.** *Update May 7: code-level audit overruled this — see below.*
- **Geist font inconsistency.** `font-sans` in Tailwind maps to `var(--font-geist-sans)` (loaded by `next/font` somewhere), not the Apple system stack the inline-styled pages use. Signin now renders in Geist; other pages render in Apple system. Probably visually near-identical, but a real inconsistency to resolve eventually (either standardize on Geist via shared layout, or override `font-sans` in `globals.css` `@theme {}`).

**Audit-driven discovery May 7:**
- **Original premise of "extract `<AppHeader>` shared by 4–5 logged-in pages" was wrong.** Code-level audit (saved to `./session-notes/audit-app-header.md`) found dashboard's top bar is unique to one page; what's actually duplicated is the back-link + title + subtitle pattern (`<PageHeader>`). The brand mark itself appears in 5 different visual treatments with no shared sizing or layout. A single `<AppHeader>` would have been three components in a trench coat. Audit overruled the roadmap and saved building the wrong thing.
- **Tailwind v4 preflight resets `list-style` globally** — must explicitly add `list-disc`/`list-decimal` to `<ul>`/`<ol>` to restore browser defaults. Latent bug if missed; caught during PolicyDocument migration when bullet lists in privacy.md would otherwise have rendered marker-less.

**Audit-driven discovery May 8:**
- **Stripe webhook bug was simpler and worse than the hypothesis suggested.** Initial hypothesis: handler missing `customer.subscription.created` case (event-type mismatch). Actual cause: hardcoded `'starter'` literal in SQL. Investigation audit overturned the hypothesis and identified the one-character change that fixes the bug. Audit-first investigation paid off: ~5 min of investigation prevented writing a more elaborate fix that wouldn't have addressed the root cause.
- **Webhook signature bypass discovered as a side-finding** during the bug audit. Not part of the original bug, but a more serious vulnerability — logged as separate loose end for dedicated commit.

**Revised ordering for the remaining mobile-responsive sweep:**
1. ~~Signin~~ ✅ Shipped May 6
2. ~~PolicyDocument~~ ✅ Shipped May 7 (commit `ee388d2`)
3. ~~PageHeader extraction~~ ✅ Shipped May 7 (commit `949bdab`)
4. ~~Billing~~ ✅ Shipped May 7 (commit `949bdab`)
5. ~~Settings~~ ✅ Shipped May 7 (commit `3a31a23`)
6. ~~Admin~~ ✅ Shipped May 7 (commit `3ba4e59` + revert `fd30075`)
7. ~~Admin/client~~ ✅ Shipped May 7 (commit `79bbc62`)
8. ~~Welcome-pro~~ ✅ Shipped May 8 (commit `6c56a38`). Calendly widget preserved cleanly. First gradient migration in the codebase — pattern established for dashboard.
9. **Onboarding** — multi-step wizard, ~310 lines all inline. ~45 minutes.
10. **Dashboard** — biggest, most stateful, last. ~60–90 minutes. Has its own unique top bar that doesn't use PageHeader.

**Loose ends:**
- Add `NEXT_PUBLIC_CALENDLY_URL` to Vercel env vars (Production + Preview + Development). Hardcoded fallback in code keeps welcome-pro working until then. 30 seconds in the dashboard.
- **Stripe webhook bug — FIXED in commit `0f06660`.** Original report noted plan staying at `starter` after Pro checkout. Audit revealed the actual cause: hardcoded `plan = 'starter'` literal in the `checkout.session.completed` SQL handler at `/api/stripe/webhook/route.ts:28`. Every checkout was overwriting the plan column to `'starter'` regardless of which tier was actually purchased. Compounding factor: no `customer.subscription.created` handler existed, so the correct plan-from-priceId derivation in `customer.subscription.updated` never fired during initial trial creation. Fix: removed the hardcoded literal from the checkout SQL (handler now writes only linkage columns), added `customer.subscription.created` as fall-through to existing `customer.subscription.updated` case. Two-line surgical diff. Manual reconciliation done for known affected client (test account, Customer ID `cus_UTcPPKXGm9uiYc`). Detection query for finding any other affected rows: `SELECT id, email, plan, stripe_customer_id FROM clients WHERE stripe_customer_id IS NOT NULL AND stripe_subscription_id IS NOT NULL AND plan = 'starter'`.
- **Onboarding Tailwind migration teed up for next session.** No auth-tier guard, can be verified at `/onboarding` directly. Audit prompt at `./session-notes/onboarding-audit-prompt.md` ready to run.
- **Webhook signature bypass at `/api/stripe/webhook/route.ts:16`** — handler falls through to `event = JSON.parse(body)` when `STRIPE_WEBHOOK_SECRET` signature header is missing. Allows unauthenticated POST requests to process synthetic events as if they were from Stripe. Real attack surface: anyone can POST to `/api/stripe/webhook` and grant themselves Pro plan by forging a `customer.subscription.created` event. ~30 min to fix in a dedicated commit. Separate from the plan-derivation fix shipped in `0f06660`.
- **`planFromPriceId` helper extraction** — priceId-to-plan mapping is currently duplicated in `/api/stripe/webhook/route.ts` and `/api/stripe/checkout/route.ts`. Risk: future plan additions only get added in one of two places, leading to subtle bugs. Extract to `lib/stripe.ts`. ~20 min, code-quality cleanup, not customer-facing.
- **"1 Gmail account" inconsistency in Starter/Trial pricing copy.** Found at `app/billing/page.tsx:30,35` and `lib/stripe.ts:12`. Lists "1 Gmail account" as a Starter/Trial feature, contradicting Phase 1.6 tiered-auth strategy where Gmail integration is Pro-only. Three resolution paths: (A) remove entirely from Starter (commit to the tiered-auth future), (B) leave alone until tiered-auth tasks actually ship and Gmail is gated in code, or (C) update copy now to match future positioning, accept gap until enforcement lands. Decision needed before publishing any tiered-auth marketing changes. Found while editing the "1 CSV source" copy on May 8 — same kind of ambiguity, different axis.

---

## Phase 3 — Sales & Event Logging

**Week 8–9** | Track revenue per market day — what came in, where, and how

- [ ] New Events tab with quick-entry form: venue, date, revenue, booth fee — *feature*
- [ ] Events table in PostgreSQL with `client_id` scoping — *backend*
- [ ] API routes: POST/GET/PATCH `/api/events` — scoped by `client_id` — *backend*
- [ ] Product sales log — optional line items per event — *feature*
- [ ] Event history view with sortable list — *UX*

**UX considerations for this phase:** "Add event" should be the most obvious action when the tab opens. Defaults: today's date, last venue used, booth fee carried forward from last event at same venue. The phone-at-the-market test: can a vendor log a sale with their phone in one hand while bagging an item with the other?

---

## Phase 4 — Expense Categories & Mileage

**Week 10–11** | Organize spending into tax-ready categories and track mileage

- [ ] Default categories: Supplies, Booth Fees, Travel/Gas, Packaging, Marketing, Other — *feature*
- [ ] Client-customizable categories — add, rename, or hide per business — *feature*
- [ ] Auto-categorization via Claude during extraction — *AI*
- [ ] Mileage log: date, destination, miles driven — *feature*
- [ ] Mileage table in PostgreSQL + API routes (scoped by `client_id`) — *backend*
- [ ] Running totals by category on Dashboard — *UX*

**UX considerations for this phase:** Auto-categorize first, ask second. Show the category Claude picked with an "edit" affordance — don't make users pick from a dropdown by default. Mileage entry should accept "drove to Chicago and back" and figure out the round-trip miles, not require the user to enter exact distance.

---

## Phase 5 — Profitability Dashboard

**Week 12–13** | Answer the real question: am I making money at each market?

- [ ] Per-event P&L: revenue minus booth fee, gas, supplies — *feature*
- [ ] Dashboard cards: total revenue, expenses, net profit, avg per event — *UX*
- [ ] Best/worst markets ranking — which venues are worth going back to — *feature*
- [ ] Monthly trend charts (revenue, expenses, net margin over time) — *feature*
- [ ] Recharts or Chart.js integration for visual graphs — *frontend*

**UX considerations for this phase:** Lead with the answer ("You made $X this month"), then offer the breakdown. Use color sparingly — green for profit, red for loss, gray for everything else. No more than 3 charts on the dashboard at once; rest live behind tabs or links.

---

## Phase 6 — AR Aging & Follow-ups

**Week 14–15** | Track wholesale/consignment invoices and chase overdue payments

- [ ] AR aging buckets: Current, 30-day, 60-day, 90+ day overdue — *feature*
- [ ] Visual aging report with color-coded urgency — *UX*
- [ ] Follow-up email templates — one-click send reminder via Gmail — *feature*
- [ ] Payment recording — mark invoices partially or fully paid — *feature*
- [ ] Outstanding balance summary on Dashboard — *UX*

**UX considerations for this phase:** Vocabulary stays accounting-standard ("AR aging," "30-day overdue"), but the action is one tap: "Send reminder." Pre-fill the reminder with a sensible polite template; user reviews and sends. Don't make them write the email from scratch.

---

## Phase 7 — Tax-Time Reports

**Week 16–17** | One-click reports to hand your CPA or file Schedule C

- [ ] Annual summary report: total revenue, expenses by category, net profit — *feature*
- [ ] Mileage summary with IRS standard rate calculation — *feature*
- [ ] Export to CSV / PDF for CPA handoff — *feature*
- [ ] Quarterly estimates helper — suggest estimated tax payments — *feature*
- [ ] Schedule C line-item mapping (which expenses go on which line) — *feature*

**UX considerations for this phase:** The "give this to my CPA" flow is the headline action. One button: generate a PDF + CSV bundle, attach to an email, send to a CPA address the user saved on first use. The Schedule C mapping is power-user territory — visible to those who want it, hidden by default.

---

# What FlowWork Can Do

AI-powered accounting automation for small businesses — from inbox to tax-ready reports.

## Smart Email Ingestion
- Connect any Gmail account via OAuth
- Auto-fetch emails by label (Invoices, AR, Expenses)
- Email history backfill with selectable date range
- Duplicate detection — never process the same email twice

## AI Data Extraction
- Claude AI reads invoices and receipts
- Extracts vendor, amount, due date, invoice #
- Confidence scoring on every extraction
- Plain-English summary of each document

## Data Migration
- CSV upload with AI column auto-mapping (XLSX coming)
- QuickBooks/Xero/Wave export hints (deterministic parser coming)
- White-glove migration for Pro tier clients

## White-Glove Onboarding (Pro Tier)
- 1:1 onboarding call via Calendly booking
- Industry-specific sample data preloaded
- Custom category configuration during call
- Priority support with same-day response

## Polished UX
- Loading spinners during async operations
- Inline error messages with actual error text
- Sample data banner with one-click clear
- Pro/Starter plan badges in header

## Multi-Client Platform
- Each client gets isolated, secure data
- Customizable modules per business type
- Admin dashboard to manage all clients
- Stripe-powered subscriptions with free trial

---

## Built For

Market vendors & craft sellers · Freelancers & consultants · Small landscaping & service companies · Food trucks & mobile businesses · Etsy / Amazon FBA sellers · Photographers & creatives · Bookkeepers & small CPA firms · Nonprofit organizations · Real estate investors · Personal trainers & coaches

---

## Pricing

| Plan | Price | Auth | Data input | Key Features |
|---|---|---|---|---|
| **Starter** | $19/mo | Email magic-link | CSV upload | Up to 100 items/month, any CSV format, expense tracking, dashboard |
| **Growth** | $49/mo | Email magic-link | CSV upload | Unlimited processing, events, mileage, AR, exports |
| **Pro** | $89/mo | Google sign-in | Gmail auto-fetch + CSV | Multi-account, custom categories, tax reports, white-glove onboarding, **Gmail auto-fetch** |

All tiers include a 14-day free trial. CSV upload supports Square, Stripe, QuickBooks, Xero, and Wave exports. Gmail integration is exclusive to Pro tier and counts toward Google OAuth's 100-user testing cap until CASA verification completes.

---

## Already Shipped (Phases 0 + 1 + 1.5 + Partial 1.6 + 1.7 + Partial 2)

Gmail OAuth + email fetching by label, email history backfill (30–365 days), Claude AI invoice extraction with confidence scoring, PostgreSQL persistence with duplicate prevention, status tracking, dashboard with aggregated stats, multi-tenant client isolation, Stripe subscription integration (checkout, webhooks, portal), CSV upload with AI column auto-mapping (XLSX pending), QuickBooks/Xero/Wave export hints, email notifications via Resend (welcome, payment-failed, trial-expiring on cron), admin dashboard with client management, onboarding flow, module toggles, custom expense categories, usage tracking, item delete/remove, white-glove onboarding for Pro tier (Calendly booking + industry-specific sample data + dashboard banner), inline error messages with actual error text, loading spinners across all async operations, env-var-backed admin allowlist, **NextAuth signin/signout UI with route-protection middleware (Next 16 `proxy.ts`)**, **custom domain `flowworks.it.com` with SSL**, **public Privacy Policy and Terms of Service pages**, **Google Auth Platform branding finalized**, **white-glove Tier 1 fixes (Pro Stripe checkout routes to `/welcome-pro`, Calendly URL configurable + prefilled with client identity, dashboard backstop banner with `welcome_pro_seen` tracking)**, **Tailwind v4 activated and validated (signin page migrated as first mobile-responsive surface)**, **PageHeader component, planColor helper, billing/settings/admin/admin-client/PolicyDocument migrated to Tailwind**, **Stripe webhook fix (plan correctly derived from subscription event, not hardcoded in checkout)**, **welcome-pro migrated to Tailwind (dark gradient hero, 4-card responsive grid, Calendly widget DOM hooks preserved)**, security hardening.

## Up Next

**Phase 1.6 remaining:**
- OAuth Production submission **paused** in favor of tiered auth strategy (Pro-only Gmail integration). See Phase 1.6 strategic decision section.
- 5 tiered-auth implementation tasks documented in Phase 1.6 — *deferred*, not blocking Phase 2 work.

**Phase 1.7 remaining (white-glove Tier 2):**
1. **Calendly webhook** — turns "user visited welcome page" into "user actually booked." Biggest unlock: banner copy upgrades from generic prompt to specific call time. ~2–4 hours.
2. **Sample data parity** — tailored data for landscaping, real estate, e-commerce, creative, bookkeeper, nonprofit, fitness. ~1–2 hours.
3. **Pro reminder cron** — chase Pro users who haven't booked within 3 days. ~1–2 hours.

**Phase 2 mobile-responsive sweep (signin shipped, 5 surfaces remaining):**
1. ✅ Signin (May 6 evening, commit `009a5a8`)
2. **PolicyDocument** — single shared component, both `/privacy` and `/terms` benefit. Lowest-risk way to lock in the Tailwind muscle on a more complex file. ~25 minutes.
3. **Header centralization** — extract shared `<AppHeader />` before dashboard work. Dashboard touches the header heavily; sharing it first means the hamburger pattern is solved once. ~60 minutes.
4. **Welcome-pro** (cautious — Calendly widget) — *not in original list because welcome-pro is technically Phase 1.7's surface, but mobile work makes more sense alongside the rest of the sweep*. ~30 minutes.
5. **Settings, Admin** — ~30 minutes each.
6. **Dashboard** — biggest, most stateful, last. ~60–90 minutes.

**Other Phase 2 items:**
- **AI auto-classification** — scan inbox, auto-label emails. Meatier feature, deserves its own session. (Will eventually be Pro-tier-only feature given Gmail dependency.)
- **Google Cloud OAuth Production review** — gated on tiered auth implementation + CASA decision. Not blocking near-term feature work.

**Loose ends:**
- Add `NEXT_PUBLIC_CALENDLY_URL` to Vercel env vars (Production + Preview + Development). Hardcoded fallback keeps welcome-pro working. 30 seconds in the Vercel dashboard.

**Recommended next coding session:** Either **PolicyDocument** (low-risk Tailwind reps on a more complex file) or **header centralization** (higher-leverage structural work that makes everything downstream cheaper). Header is the higher-leverage choice if you've got 60 minutes; PolicyDocument if you want a small completed thing in 25–30 minutes. Both are confined enough to fit a single session.

Alternative non-Phase-2 options if mobile work isn't calling: white-glove Tier 2 Calendly webhook (~2–4 hours) keeps momentum on the Pro experience, and the audit context is still fresh.

---

## Tech Stack & Tooling

Next.js 16 (App Router), TypeScript, **Tailwind v4 (CSS-first config in `globals.css`, no `tailwind.config.*` file)**, PostgreSQL (Railway), Stripe Checkout/Webhooks/Portal, NextAuth (Google OAuth), Anthropic Claude API (extraction, column mapping, sample data), Resend (transactional email), Calendly (booking), Vercel hosting (custom domain `flowworks.it.com`), Vercel Cron (daily trial-expiring sweep).

**Styling architecture:** Mixed during the Phase 2 mobile-responsive migration. New and touched components use Tailwind utility classes (mobile-first responsive); untouched components retain inline `style={...}` objects backed by a per-file `s` const at file bottom. The `s` const at the bottom of a file is the visible signal of "still inline." Each file is fully one or fully the other — never mixed within a single file.

**Development workflow:** Claude Code (Opus 4.7) in VS Code terminal with Vercel MCP for deployment logs, GitHub for version control, notepad for emergency edits, `/api/test-email` diagnostic endpoint for Resend health checks.

---

## Competitive Landscape

QuickBooks $38–$275/mo (raised prices 15–25% May 2026). Xero $25–$90/mo. FreshBooks $19–$60/mo. Wave: free (fees on payments). FlowWork undercuts all paid competitors while offering AI-first automation none of them match. All tiers include a 14-day free trial.
