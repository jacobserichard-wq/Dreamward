# FlowWork Product Roadmap

**Small Business Edition** | Updated May 11, 2026

**8 Phases** · **55+ Tasks** · **17 Weeks** · **Phase 0–1 SHIPPED** · **Phase 1.5 SHIPPED** · **Phase 1.6 IN PROGRESS (OAuth submission paused — CASA decision)** · **Phase 1.7: Tier 1 + Tier 2 complete; Tier 3 (admin tooling) pending** · **Phase 2: mobile-responsive 10/10 + AI auto-classification (MVP, testing cluster, polish batch) shipped**

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

**Shipped May 9 (sub-session 4):**
- [x] **Onboarding migrated to Tailwind** — third consumer of the dark gradient pattern (`bg-gradient-to-br from-slate-800 to-slate-700`, byte-equivalent to welcome-pro per audit). Three-step wizard preserved (welcome -> business name -> industry). First form-input migration in the codebase: text input and 11 industry buttons gained explicit focus rings (`focus:ring-2 focus:ring-blue-500/20` on input, `focus:ring-2 focus:ring-blue-500/30` on buttons), closing an a11y gap that existed in the inline-style version. Mobile-first responsive grid (`grid-cols-1 sm:grid-cols-2`) prevents long label overflow at 320px. State, autoFocus on Step 1 input, Enter-to-advance keyboard handler, and Pro/non-Pro routing on completion all preserved. Verified end-to-end at desktop / 390px / 375px / 320px including keyboard tab order. Commit `fdee682`. — *UX*

**Shipped May 10 (sub-session 5):**
- [x] **Dashboard audit complete** — full read-only audit at `./session-notes/audit-dashboard.md`. 1304 lines, 17 useState slots, 9 useCallback handlers, 307 lines of inline styles. All hex values map cleanly to Tailwind tokens (no oddballs). Top bar gradient is byte-equivalent to welcome-pro and onboarding (third consumer of the dark gradient pattern). Three risk callouts: pre-existing 320px card grid horizontal overflow bug (`minmax(340px, 1fr)` exceeds viewport), three dynamic-color sites needing translation strategy (StatCard prop, breakdownCard borderLeft, confidence ternary), and modal table density. Audit recommended Option B: extract CsvReviewModal first, then migrate dashboard in a single subsequent commit. — *audit*
- [x] **CsvReviewModal extracted** — pure relocation of ~120 lines of modal JSX from `app/page.tsx` into new `app/components/CsvReviewModal.tsx`. No styling changes — inline styles preserved verbatim. Modal renders and functions identically. Component takes 6 props (`uploadReview`, `reviewRows`, `setReviewRows`, `onCancel`, `onConfirm`, `importing`). State remains in parent `Home`; modal is purely presentational with callback props for the two exit paths. App/page.tsx: 1304 → 1194 lines. Verified end-to-end: modal opens, table renders, per-row checkboxes, select-all/uncheck-all, category dropdowns, Cancel and Import paths all working. Commit `de9e876`. — *refactor*

**Shipped May 10 (sub-session 6):**
- [x] **Dashboard migrated to Tailwind** — final surface of the Phase 2 mobile-responsive sweep, 10/10 shipped. `app/page.tsx` is the third consumer of the dark gradient pattern in its top bar (`bg-gradient-to-br from-slate-800 to-slate-700`, byte-equivalent translation to welcome-pro and onboarding); `app/components/CsvReviewModal.tsx` is now also fully Tailwind, post-extraction. The 307-line `s` const at the bottom of `app/page.tsx` removed entirely, plus ~73 lines of JSX shrinkage from removing inline-style spread merges. Pre-existing 320px card grid horizontal overflow bug fixed: `grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]` replaces unconditional `minmax(340px, 1fr)`. `statusStyle()` helper rewritten as `statusBadgeClasses()` returning Tailwind class strings (kept inline at file bottom — single consumer; the `lib/planColor.ts` extraction precedent only kicks in at two consumers). StatCard `color` prop renamed to `colorClass` and converted from hex to Tailwind border-side class string (`border-t-blue-500` etc.); BreakdownCard's data array followed the same pattern (`borderClass: "border-l-amber-500"` etc.). Confidence color ternary inlined as a className-returning ternary at both consumer sites (item card + modal table). Empty `dashboard:{}` and `breakdownSection:{}` style entries dropped. Native `disabled` attribute + `disabled:` Tailwind variants used wherever a button supports it (Process with AI, Clear sample data, status update buttons, Remove, Import, backfill select); conditional className retained on the Upload CSV `<label>` since labels don't honor the disabled attribute. All 17 useState slots, all 9 useCallback handlers, both useEffect blocks (loadItems on mount; loadClient with `/onboarding` redirect when `onboardingCompleted === false`), optimistic status update with rollback, per-item `Set<string>` loading states for delete and status-update, plan-gated AR Follow Up label visibility, items-per-month limit check, welcome-pro backstop banner condition (Pro plan + `welcomeProSeen=false`), and sample-data banner condition all preserved. `app/page.tsx`: 1194 → 814 lines. Verified end-to-end at desktop / 390 / 375 / 320 including the CSV upload + import flow. Commit `0c64005`. — *UX*
  - **Polish: emails-tab toolbar wrapping at 320/375/390.** Both inner `<div className="flex gap-2">` groups (labels + actions) lacked `flex-wrap` — surfaced via leaf-overflower probe at live 320px verification (the outer toolbar wrapped its two children, but each inner group's children rode past the viewport). Two single-word class additions; `npx tsc --noEmit` clean, diff confined to two `+flex-wrap ` additions. Commit `7f198f6`.

**Shipped May 10 (sub-session 7):**
- [x] **Stripe webhook signature verification** — closed a critical bypass at `app/api/stripe/webhook/route.ts:6–17` where the handler fell through to `JSON.parse(body)` whenever `STRIPE_WEBHOOK_SECRET` was unset *or* the `stripe-signature` header was missing on the incoming request, the condition being `if (webhookSecret && sig)` rather than mandatory-both. Allowed unauthenticated POSTs to forge subscription events and self-grant Pro plans via a documented two-curl attack chain (plant `stripe_customer_id` via `checkout.session.completed`, then write `plan = 'pro'` via `customer.subscription.created`). Audit (`session-notes/audit-stripe-webhook-signature.md`) confirmed the bypass pattern is bounded to this one handler — no other `app/api/**` route uses the conditional-verification fallthrough shape. Fix replaced the conditional block with mandatory `stripe.webhooks.constructEvent`: 500 if secret unset, 400 if signature missing, 400 on signature verification failure, no fallback parse path. Single-file diff (+13/−4). Verified locally via `npx tsc --noEmit` clean and Stripe CLI signed-event happy path; verified post-deploy via Stripe Dashboard test event (200 received) and the audit §3 curl attack payload (400 missing-signature, no DB writes, `clients.plan` for the targeted row unchanged). Commit `552f9b8`. — *security*

**Shipped May 10 (sub-session 8):**
- [x] **Loose-ends batch — three roadmap entries closed in four commits.** Extracted `planFromPriceId` helper to `lib/stripe.ts` (commit `4fe7306`), deduping the priceId→plan mapping that had drifted between `webhook/route.ts`'s inline if/else chain and the existing `PLANS` config. Removed `"1 Gmail account"` and `"3 Gmail accounts"` from Starter and Growth pricing copy (commit `cec4146`) per the Phase 1.6 tiered-auth strategy where Gmail is Pro-only; Claude Code flagged Trial as an inadvertent omission from the prompt scope, and a one-line parity fix shipped as commit `862b69a`. Deleted the 16 stuck-`less` debris files at the repo root using PowerShell's `\\?\` long-path prefix + `-LiteralPath`, and removed the stale `*Three button*` gitignore pattern (commit `d0677f7`). Audit-first pass (`session-notes/audit-loose-ends-batch.md`) reframed the duplication question usefully — the actual fix was smaller and cleaner than the roadmap's framing implied. — *cleanup*

**Shipped May 10 (sub-session 9):**
- [x] **Small follow-ups batch — three loose ends from sub-session 8 closed in three commits.** Consolidated `PlanName` to a single canonical export (commit `4426de5`): `lib/stripe.ts` now imports the canonical type from `lib/plans.ts` and uses `Extract<PlanName, "starter" | "growth" | "pro">` for `planFromPriceId`'s return, tying the paid-plan subset to canonical `PlanName` at the type level rather than redeclaring a bare literal that could silently drift. Deleted the dead `PLANS.features` field from `lib/stripe.ts` (commit `eb2adee`); pre-flight grep re-confirmed zero consumers (`clientInfo.features` reads `/api/client`'s shape, `PLAN_DETAILS.features` is a separate local object in `app/billing/page.tsx`). Swept the 16 stale "Pager debris" gitignore patterns from `776d045` and relocated `.claude/` to share a single "Claude Code workspace-local" section header with `session-notes/` (commit `c170633`); pre-flight per-pattern check confirmed zero matches on disk. First sub-session in this wave that closed debt without opening any new loose ends. — *cleanup*

**Shipped May 10 (sub-session 10):**
- [x] **Small-wins audit batch — four ship-tonight findings closed in four commits.** Read-only audit (`session-notes/audit-small-wins.md`) across four categories (dev experience, code hygiene, dependencies, cron health) surfaced four ship-tonight candidates plus a real customer-facing regression caught incidentally. Removed a debug `console.log` from `lib/email.ts` that leaked recipient emails and an API-key-existence boolean to Vercel logs on every transactional send (commit `34412fd`). Deleted a dead `stripe` import from `app/api/billing/route.ts` surfaced by `tsc --noUnusedLocals` (commit `089764f`). Added `npm run typecheck` as a stable shortcut for the per-session sanity check we'd been running as `npx tsc --noEmit` (commit `b5de7f3`). Replaced three hardcoded `flow-work-khaki.vercel.app` URLs in welcome / trial-expiring / payment-failed email templates with a `baseUrl` const reading `process.env.NEXTAUTH_URL` with a `flowworks.it.com` fallback — every customer email since the Phase 1.6 custom-domain switch had been linking recipients to the stale deployment URL (commit `3593282`). Audit-first paid for itself: the email regression wasn't on the loose-ends list and would have stayed live indefinitely without the audit pass. — *cleanup*

**Shipped May 10 (sub-session 11):**
- [x] **AI auto-classification MVP — Phase 2 capstone shipped in four commits.** Audit-first capstone session. The audit (`session-notes/audit-ai-classification.md`) reframed the feature: classification already existed in the codebase on both ingest paths (`/api/process` Gmail, `/api/upload` CSV), so the work was enrichment (adding industry-awareness) not greenfield. Audit's recommended design was enriched-extraction with optional reclassification cron; the MVP (commits 1–4 of the 7-commit plan) shipped industry-aware classification on both paths plus the customer-facing settings UI. Bootstrap pass generated `session-notes/draft-categories.md` (440 lines, 11 industries × 8–17 categories with example transactions, cross-industry analysis surfacing 7 universal categories appearing in 3+ industries). User reviewed and confirmed the data. `lib/categories.ts` (commit `0f7bf4c`) implemented the universal-core + industry-overlay pattern with rich `Category` shape `{name, description, type, taxDeductible?}`; 87 categories total across the module. `/api/process` (commit `41e620c`) extended the Anthropic SDK call to assign sub-categories alongside the existing umbrella-type triage; defensive validation drops AI hallucinations. `/api/upload` (commit `6a30d00`) replaced the `settings.custom_categories || HARDCODED_FALLBACK` ternary with `Array.from(new Set([...defaults, ...custom]))`, deleting the 10-element hardcoded fallback. Settings UI (commit `21fa43d`) renders industry defaults as passive slate-100 pills above the editable green-50 additions list; same commit removed the misleading "Pro plan required" badge from the `custom_categories` module toggle since the feature is open to all tiers. Tested end-to-end with `meridian.supply.test@gmail.com`: industry defaults render correctly; legacy `DEFAULT_CATEGORIES` required a one-time cleanup via "Clear custom categories"; CSV upload classified 3 test rows with appropriate confidence stratification (95% / 80% / 70%). The 70% row (AT&T telecom bill → "Software & SaaS") surfaced a taxonomy gap: marketplace overlay doesn't include telecom/utilities categories — logged as a follow-up. — *feature*

**Shipped May 11 (sub-session 12):**
- [x] **Sub-session 11 testing-findings cluster closed in four commits.** Promoted Telecom & Internet + Utilities to `UNIVERSAL_CATEGORIES` (commit `2787225`) — closes the taxonomy gap where AT&T was forced into "Software & SaaS" at 70% confidence; universals now 9 (was 7) and the duplicate Utilities entry in the `other` overlay was dropped. Default landing tab changed from Emails to Dashboard via a one-line `useState<Tab>` initializer in `app/page.tsx` (commit `389a2ca`) — signed-in users now land on the overview cards rather than the noisy data-management surface. Settings link added to the dashboard header between PRO badge and Sign out (commit `f81889f`) using the existing `next/link` import and matching the Sign out text-link styling — closes the nav gap where customers had to type `/settings` directly. Dirty-state save UX added to both Active Modules and Expense Categories sections of `app/settings/page.tsx` (commit `09eca8b`): `savedModules` / `savedCategories` snapshots captured on PATCH success, `isDirty` booleans via `useMemo` + `JSON.stringify` compare, save buttons demoted to slate-300 + disabled when clean and primary blue when dirty, amber "Unsaved changes" / green "✓ Saved" labels mutually exclusive in the JSX, and a `beforeunload` listener installed only while either section is dirty. No backend changes across the four commits; all four were UI / data / configuration tweaks downstream of the sub-session 11 MVP infrastructure. — *cleanup*

**Shipped May 11 (sub-session 13):**
- [x] **Polish batch + 320px overflow closed in four commits.** Four commits closed all three deferred audit-plan commits from sub-session 11 plus the 320px mobile overflow flagged during sub-session 12's testing. `4f201cf` fixed the 320px header overflow that was actively bug-class for STARTER-plan customers (~33px overshoot at narrowest viewport) via Tailwind `sm:` mobile-only shrink on the PRO badge, Settings link, Sign out button, and container gap; desktop rendering unchanged. `2649377` added `processed_items` schema telemetry (`ai_classified_at`, `ai_model`, `original_ai_category`; `confidence` already existed verbatim so `ai_confidence` was skipped) and established the `db/migrations/` versioned convention starting at `0001_add_ai_telemetry.sql` — Phase-1-then-Phase-2 ordering (migration on Railway first, code deploy second) avoided the column-not-yet-existing hazard. `727e6a9` shipped `POST /api/reclassify` + dashboard banner button — closes the "mixed-state dashboard" finding from sub-session 11 testing by letting customers self-serve migration of pre-11.x umbrella-type items in batches of 50; defensive validation drops AI hallucinations, transaction-wrapped UPDATEs preserve atomicity. `90bb597` extracted `lib/reclassify.ts` and added the Sunday weekly cron that runs the same logic across all clients with umbrella items; the dashboard route slimmed 235 → 28 lines as the thin HTTP wrapper, and the cron uses Option X (single daily cron with `getUTCDay() === 0` check) keeping `vercel.json` unchanged. With this batch, the entire AI auto-classification thread (sub-sessions 11 audit → MVP → testing cluster → polish batch) is fully shipped. — *polish*

**Shipped May 11 (sub-session 14):**
- [x] **Calendly webhook (Phase 1.7 Tier 2).** Audit-first. The audit (`session-notes/audit-calendly-webhook.md`) collapsed the original plan by one commit — the welcome-pro Calendly embed already carried `utm_content=<client.id>` from Tier 1 (commit `1e3f42d`), so no embed-change commit was needed and the webhook matches bookings by UTM today. Three commits: `defc0a5` added three `clients` columns (`pro_call_booked_at`, `pro_call_scheduled_for`, `calendly_event_uri`) as migration `0002_add_calendly_booking_columns.sql` under the `db/migrations/` convention established in sub-session 13. `c72eae6` shipped `/api/calendly/webhook` — HMAC-SHA256 signature verification done by hand with Node `crypto` (no Calendly SDK), structure mirroring the hardened Stripe webhook from sub-session 7, with a 5-minute replay-protection window on the timestamp; handles `invitee.created` (match client by `payload.tracking.utm_content`, write the three columns) and `invitee.canceled` (find by `calendly_event_uri`, clear them). A reschedule flows through naturally as canceled-then-created — no special-casing. `9f47eb3` made the dashboard banner three-state — "Book your call" amber prompt when unbooked, green "Your call is scheduled for [Weekday], [Month Day] at [time]" confirmation when upcoming, hidden once past — and exposed `proCallBookedAt` + `proCallScheduledFor` via `/api/client` (`calendly_event_uri` stays internal). The banner's visibility gate moved from `welcome_pro_seen` to `pro_call_booked_at` — visiting the welcome page is not the same signal as actually booking. End-to-end loop: book → webhook → DB → `/api/client` → banner. Two user setup steps remain before production traffic works (register the Calendly webhook subscription, add `CALENDLY_WEBHOOK_SIGNING_KEY` to Vercel) — documented in `commit14.2-report.md`. — *feature*

**Shipped May 11 (sub-session 15):**
- [x] **Small-cleanups batch + Phase 1.7 Tier 2 completion.** Six commits. Three accumulated-debt cleanups: `ea5182c` widened `ProcessedItem.category` from the stale umbrella union (`"invoice" | "expense" | "ar_followup"`) to `string` — the value space expanded in sub-session 11 and the type had been wrong since; also removed the `readonly string[]` workaround annotation on `UMBRELLA_VALUES` that the narrow type had forced. `9f49ca7` consolidated `INDUSTRY_DISPLAY_NAMES` — triplicated across `app/api/process`, `app/api/upload`, and `lib/reclassify` — into a single `Record<Industry, string>` export in `lib/categories.ts`; the `Record<Industry, string>` constraint now forces a display-name entry whenever a new industry slug is added, preventing the kind of drift that created the triplication in the first place. `490b372` removed the dead `welcome_pro_seen` write path (`/api/welcome-pro/seen` route, the fire-and-forget POST in `app/welcome-pro/page.tsx`, and the field in `/api/client`'s response) — sub-session 14's Calendly banner moved the gate to `pro_call_booked_at`, leaving `welcome_pro_seen` written-but-unread. The DB column itself was left as a harmless tombstone. Two Phase 1.7 Tier 2 features: `8e38337` added the Pro onboarding-call reminder cron — a daily pass selecting Pro clients with `pro_call_booked_at IS NULL`, `pro_call_reminder_sent_at IS NULL`, and `created_at <= NOW() - INTERVAL '3 days'`, sending via Resend mirroring the trial-email path, stamping `pro_call_reminder_sent_at` only on successful send so failed sends retry next run (migration `0003_add_pro_call_reminder_sent.sql`). Anchor is `created_at` since no Pro-upgrade timestamp exists — documented limitation: customers who upgrade long after signup won't be reminded. `713f9fd` filled sample data for the 6 industries that lacked it (service, ecommerce, bookkeeper, nonprofit, realestate, fitness) — all 11 industries now populated, ~12 realistic items each. One welcome-page polish commit: `82837f7` re-categorized all 132 sample items across all 11 industries with industry-aware categories drawn verbatim from `UNIVERSAL_CATEGORIES` + each industry's `INDUSTRY_OVERLAY` — and widened `SampleItem.category` to `string` to match `ProcessedItem.category`. The Pro welcome page now showcases the AI classification rather than the pre-sub-session-11 umbrella experience. With sub-session 14's Calendly webhook plus these, **Phase 1.7 Tier 2 is complete.** — *cleanup + feature*

**Discovered May 6 (not in original Phase 2 scope, but real):**
- **Brand mark / header is duplicated across 4–5 pages** (dashboard, welcome-pro, billing, settings, admin). Each rebuilds the FlowWork logo + sign-out independently. Phase 2 mobile work without a shared header means every page rewrites the hamburger logic separately. **Header centralization should happen *before* dashboard mobile work, not after.** *Update May 7: code-level audit overruled this — see below.*
- **Geist font inconsistency.** `font-sans` in Tailwind maps to `var(--font-geist-sans)` (loaded by `next/font` somewhere), not the Apple system stack the inline-styled pages use. Signin now renders in Geist; other pages render in Apple system. Probably visually near-identical, but a real inconsistency to resolve eventually (either standardize on Geist via shared layout, or override `font-sans` in `globals.css` `@theme {}`).

**Audit-driven discovery May 7:**
- **Original premise of "extract `<AppHeader>` shared by 4–5 logged-in pages" was wrong.** Code-level audit (saved to `./session-notes/audit-app-header.md`) found dashboard's top bar is unique to one page; what's actually duplicated is the back-link + title + subtitle pattern (`<PageHeader>`). The brand mark itself appears in 5 different visual treatments with no shared sizing or layout. A single `<AppHeader>` would have been three components in a trench coat. Audit overruled the roadmap and saved building the wrong thing.
- **Tailwind v4 preflight resets `list-style` globally** — must explicitly add `list-disc`/`list-decimal` to `<ul>`/`<ol>` to restore browser defaults. Latent bug if missed; caught during PolicyDocument migration when bullet lists in privacy.md would otherwise have rendered marker-less.

**Audit-driven discovery May 8:**
- **Stripe webhook bug was simpler and worse than the hypothesis suggested.** Initial hypothesis: handler missing `customer.subscription.created` case (event-type mismatch). Actual cause: hardcoded `'starter'` literal in SQL. Investigation audit overturned the hypothesis and identified the one-character change that fixes the bug. Audit-first investigation paid off: ~5 min of investigation prevented writing a more elaborate fix that wouldn't have addressed the root cause.
- **Webhook signature bypass discovered as a side-finding** during the bug audit. Not part of the original bug, but a more serious vulnerability — logged as separate loose end for dedicated commit.

**Audit-driven discovery May 9:**
- **Form input focus rings as a category-level a11y improvement.** The original inline-style version had `outline: none` with no replacement focus styling — keyboard users had no visual focus indicator. Tailwind v4 preflight does the same. The migration was the natural moment to close the gap. Future input-bearing surfaces should follow the same pattern.
- **Returning-user onboarding flow is unguarded** (out-of-scope finding from audit Section 5). The `/onboarding` page always starts at step 0, even for users who already completed onboarding. Decision deferred — not blocking anything customer-facing.

**Audit-driven discovery May 10:**
- **Pre-existing 320px horizontal overflow bug in dashboard card grid.** The `repeat(auto-fill, minmax(340px, 1fr))` template forces 340px minimum column width which exceeds 320px viewports. Already broken on iPhone SE-class devices, currently masked by the fact that mobile users would have other layout failures first. Migration must fix this with `grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]` (or reduce min to 280px).
- **Mystery file `Downloads/dashboard_page.tsx` was a stale generic template, not work-in-progress.** Discovered during audit triage. Comparison report at `./session-notes/dashboard-downloads-comparison.md` showed it used wrong palette (gray/emerald vs. FlowWork's slate/green), wrong schema (`vendor_name` vs. real `vendor`), missing CsvReviewModal entirely, missing the card grid entirely, and would have crashed at runtime. Deleted. Lesson: when committing past-experiment artifacts to "Downloads" or scratch locations, delete them or move them to a clearly-archive subfolder so they don't surface as ambiguous diff signals later.
- **Functional-setter rewrite as a category-level pattern decision.** When extracting a component that uses `setState(prev => ...)` form, the cleanest prop shape is the flat callback `(value: T) => void`. The functional form (`Dispatch<SetStateAction<T>>`) preserves React's batching guarantees but couples the child to the parent's setter shape. CsvReviewModal extraction used the flat shape and rewrote three internal `setReviewRows(prev => prev.map(...))` calls to `setReviewRows(reviewRows.map(...))`. Behavior is equivalent for single-event-per-render UX. If concurrent state updates are ever introduced (e.g., select-all + auto-categorize firing in one tick), revisit by switching the prop type to `Dispatch<SetStateAction<T>>`. Documented as known compromise in the modal extraction commit message.

**Revised ordering for the remaining mobile-responsive sweep:**
1. ~~Signin~~ ✅ Shipped May 6
2. ~~PolicyDocument~~ ✅ Shipped May 7 (commit `ee388d2`)
3. ~~PageHeader extraction~~ ✅ Shipped May 7 (commit `949bdab`)
4. ~~Billing~~ ✅ Shipped May 7 (commit `949bdab`)
5. ~~Settings~~ ✅ Shipped May 7 (commit `3a31a23`)
6. ~~Admin~~ ✅ Shipped May 7 (commit `3ba4e59` + revert `fd30075`)
7. ~~Admin/client~~ ✅ Shipped May 7 (commit `79bbc62`)
8. ~~Welcome-pro~~ ✅ Shipped May 8 (commit `6c56a38`). Calendly widget preserved cleanly. First gradient migration in the codebase — pattern established for dashboard.
9. ~~Onboarding~~ ✅ Shipped May 9 (commit `fdee682`). Form input focus rings established as a pattern; mobile-first grid; gradient parity with welcome-pro confirmed.
10. **Dashboard** — audit complete, modal extracted (May 10, commit `de9e876`). app/page.tsx now 1194 lines (1304 - 110 from modal extraction). Per audit recommendation: single-commit migration of dashboard core + modal + statusBadgeClasses helper extraction + dynamic-color prop translation + 320px card grid fix. Realistic estimate: ~75 minutes in a clean session.

**Loose ends:**
- **Stripe webhook bug — FIXED in commit `0f06660`.** Original report noted plan staying at `starter` after Pro checkout. Audit revealed the actual cause: hardcoded `plan = 'starter'` literal in the `checkout.session.completed` SQL handler at `/api/stripe/webhook/route.ts:28`. Every checkout was overwriting the plan column to `'starter'` regardless of which tier was actually purchased. Compounding factor: no `customer.subscription.created` handler existed, so the correct plan-from-priceId derivation in `customer.subscription.updated` never fired during initial trial creation. Fix: removed the hardcoded literal from the checkout SQL (handler now writes only linkage columns), added `customer.subscription.created` as fall-through to existing `customer.subscription.updated` case. Two-line surgical diff. Manual reconciliation done for known affected client (test account, Customer ID `cus_UTcPPKXGm9uiYc`). Detection query for finding any other affected rows: `SELECT id, email, plan, stripe_customer_id FROM clients WHERE stripe_customer_id IS NOT NULL AND stripe_subscription_id IS NOT NULL AND plan = 'starter'`.
- **Returning-user onboarding flow is unguarded.** `/onboarding` always starts at step 0 even for users with `business_name` and `industry` already set. Either add a client-side guard or make `/onboarding` idempotent. Not customer-facing — `/api/onboarding` remains the data integrity guard. Decision deferred.
- **README rewrite.** Currently unchanged create-next-app boilerplate. Should describe FlowWork (AI accounting automation for small business), tech stack (Next.js 16, Tailwind v4, Postgres on Railway), and the current Phase 2 state. ~30–60 min.
- **`.env.example` creation.** Document the 12 distinct `process.env.*` references identified in the small-wins audit (DATABASE_URL, GOOGLE_*, STRIPE_*, NEXTAUTH_*, RESEND_API_KEY, ANTHROPIC_API_KEY, CRON_SECRET, ADMIN_EMAILS, NEXT_PUBLIC_CALENDLY_URL). Group as required vs. optional based on whether each has a fallback. ~20 min.
- **Dependency hygiene sweep.** Multiple items, batched as one future session: 4 in-range patch/minor updates (`tailwindcss` / `@tailwindcss/postcss` 4.2→4.3, `stripe` 22.1.0→22.1.1, `@types/node` patch) via `npm install`; the Next 16.2.4 → 16.2.6 patch (pinning policy decision); 2 moderate `npm audit` items (waiting on upstream Next patch); TypeScript 5 → 6 major (changelog review); Anthropic SDK 0.92 → 0.95 major (changelog review). ~30–90 min depending on how aggressive on majors.
- **Nonprofit taxonomy has no "Fundraising" category — deferred design question, not quick debt.** Surfaced in 15.5b when a gala venue rental had no good category home and had to be placed under `Office Rent & Utilities` (a facility cost in spirit, but conceptually "fundraising overhead"). Same gap deferred in the AI-classification audit §10 Q3: functional classification for nonprofits (Program / Management & General / Fundraising) is orthogonal to the natural-axis taxonomy the rest of `lib/categories.ts` uses; adding it would either duplicate axes or require nonprofit-specific overlay restructuring. Not a quick commit — a taxonomy-design decision before any code. Reference: `commit15.5b-report.md` §3 + `session-notes/audit-ai-classification.md` §10 Q3.

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

Gmail OAuth + email fetching by label, email history backfill (30–365 days), Claude AI invoice extraction with confidence scoring, PostgreSQL persistence with duplicate prevention, status tracking, dashboard with aggregated stats, multi-tenant client isolation, Stripe subscription integration (checkout, webhooks, portal), CSV upload with AI column auto-mapping (XLSX pending), QuickBooks/Xero/Wave export hints, email notifications via Resend (welcome, payment-failed, trial-expiring on cron), admin dashboard with client management, onboarding flow, module toggles, custom expense categories, usage tracking, item delete/remove, white-glove onboarding for Pro tier (Calendly booking + industry-specific sample data + dashboard banner), inline error messages with actual error text, loading spinners across all async operations, env-var-backed admin allowlist, **NextAuth signin/signout UI with route-protection middleware (Next 16 `proxy.ts`)**, **custom domain `flowworks.it.com` with SSL**, **public Privacy Policy and Terms of Service pages**, **Google Auth Platform branding finalized**, **white-glove Tier 1 fixes (Pro Stripe checkout routes to `/welcome-pro`, Calendly URL configurable + prefilled with client identity, dashboard backstop banner with `welcome_pro_seen` tracking)**, **Tailwind v4 activated and validated (signin page migrated as first mobile-responsive surface)**, **PageHeader component, planColor helper, billing/settings/admin/admin-client/PolicyDocument migrated to Tailwind**, **Stripe webhook fix (plan correctly derived from subscription event, not hardcoded in checkout)**, **Stripe webhook signature verification (mandatory `constructEvent`, no fallback parse path)**, **welcome-pro migrated to Tailwind (dark gradient hero, 4-card responsive grid, Calendly widget DOM hooks preserved)**, **onboarding migrated to Tailwind (form input focus rings, mobile-first industry grid, dark gradient parity with welcome-pro)**, **dashboard audit complete (`./session-notes/audit-dashboard.md`)**, **CsvReviewModal extracted to its own component (commit `de9e876`, pure relocation, inline styles preserved for upcoming Tailwind migration)**, **dashboard migrated to Tailwind (third consumer of the dark gradient top bar, `statusBadgeClasses` helper for status pills, dynamic-color prop translation for `StatCard` / breakdown cards / confidence, 320px card grid overflow fix, `CsvReviewModal` migrated alongside)**, **loose-ends batch (planFromPriceId helper, Gmail removed from Starter/Growth/Trial pricing copy, repo-root debris cleared)**, **small follow-ups batch (PlanName consolidated to single canonical export, dead PLANS.features removed, stale gitignore patterns swept)**, **NEXT_PUBLIC_CALENDLY_URL configured in Vercel (Production + Preview) since May 6 — verified May 10**, **small-wins audit batch (PII log removed, dead stripe import deleted, typecheck script added, stale transactional-email URLs fixed — real customer-facing regression)**, **AI auto-classification MVP (industry-aware categorization on both Gmail and CSV ingest paths, customer-facing settings UI showing industry defaults + customer additions)**, **sub-session 11 testing-findings cluster closed (telecom/utilities promoted to universals, default landing tab → Dashboard, settings nav link in dashboard header, dirty-state save UX with beforeunload warning)**, **sub-session 13 polish batch (320px header fix, `processed_items` schema telemetry + `db/migrations/` convention, `/api/reclassify` endpoint + dashboard button, weekly reclassify cron via extracted `lib/reclassify.ts`)**, **Calendly webhook (Phase 1.7 Tier 2) — `invitee.created`/`invitee.canceled` handling with HMAC-SHA256 verification, three-state Pro onboarding-call banner**, **sub-session 15 — small-cleanups batch (`ProcessedItem.category` type widening, `INDUSTRY_DISPLAY_NAMES` consolidation, `welcome_pro_seen` dead-write removal), Pro onboarding-call reminder cron (migration `0003`, daily-send-once flagged on `pro_call_reminder_sent_at`), sample-data parity for all 11 industries + industry-aware categories across all 132 sample items**, security hardening.

## Up Next

**Phase 1.6 remaining:**
- OAuth Production submission **paused** in favor of tiered auth strategy (Pro-only Gmail integration). See Phase 1.6 strategic decision section.
- 5 tiered-auth implementation tasks documented in Phase 1.6 — *deferred*, not blocking Phase 2 work.

**Phase 1.7 Tier 2 — COMPLETE:**
1. ~~**Calendly webhook**~~ — ✅ shipped sub-session 14 (commits `defc0a5`, `c72eae6`, `9f47eb3`). Requires two user setup steps before production traffic works — see `commit14.2-report.md`.
2. ~~**Sample data parity**~~ — ✅ shipped sub-session 15 (commit `713f9fd` filled 6 missing industries, `82837f7` re-categorized all 132 items with industry-aware values).
3. ~~**Pro reminder cron**~~ — ✅ shipped sub-session 15 (commit `8e38337` + migration `0003`). Anchored on `created_at`; documented limitation for customers who upgrade long after signup.

**Phase 2 mobile-responsive sweep:** COMPLETE — 10/10 surfaces shipped (signin → dashboard, May 6–10) plus toolbar polish fix (`7f198f6`). Audit-driven discoveries logged in sub-session entries.

**Other Phase 2 items:**
- **AI auto-classification** — fully shipped across three sub-sessions. Sub-session 11 (MVP: industry-aware classification on both Gmail and CSV ingest paths + customer-facing settings UI). Sub-session 12 (testing-findings cluster: telecom/utilities universals, default landing tab, settings nav link, dirty-state save UX). Sub-session 13 polish batch (schema telemetry + `db/migrations/` convention, `/api/reclassify` endpoint + dashboard button, weekly Sunday cron). The thread is closed.
- **Google Cloud OAuth Production review** — gated on tiered auth implementation + CASA decision. Not blocking near-term feature work.

**Recommended next coding session:** All near-term feature work is now shipped — Phase 2 (AI auto-classification) and the entirety of Phase 1.7 Tier 1 + Tier 2 (Calendly webhook + Pro reminder cron + sample-data parity). The accumulated small cleanups are also closed. The honest framing of what's left:

- **Phase 1.7 Tier 3** — admin tooling for call completion + the "priority support SLA" Option A/B product decision. Strategic, bigger; needs product judgment before code. The remaining Phase 1.7 work.
- **Sub-session 10 audit follow-ups** — **README rewrite** (~30–60 min), **`.env.example` creation** (~20 min), **dependency hygiene sweep** (~30–90 min). Could batch as a 1.5–3 hr documentation/hygiene session.
- **Returning-user onboarding guard** (~30 min) — `/onboarding` always starts at step 0 even for users already onboarded. Not customer-facing yet, but a small UX correctness fix.
- **Nonprofit fundraising-taxonomy gap** — deferred design question (see loose-ends list). Not quick debt; needs a taxonomy decision before code.
- **Calendly Production setup steps** — still pending (register the Calendly webhook subscription, add `CALENDLY_WEBHOOK_SIGNING_KEY` to Vercel) before the webhook endpoint can process real production traffic. ~10 min user-side work; see `commit14.2-report.md`.
- **Phase 1.6 Tiered Auth** — still deferred, gated on CASA decision + Pro-tier demand signal.
- **Phases 3–7** — Events module, mileage, AR aging, profitability dashboard, tax-time reports. The next *major* arc when ready for new-feature work.

The cleanest "build something new" next session is **Phase 3 (Events module)** — that's the next big feature thread. The cleanest "keep clearing debt" alternative is the **documentation/hygiene batch + returning-user onboarding guard** (~2–4 hr together). The Phase 1.7 Tier 3 strategic decision needs a product call before becoming code-actionable.

---

## Tech Stack & Tooling

Next.js 16 (App Router), TypeScript, **Tailwind v4 (CSS-first config in `globals.css`, no `tailwind.config.*` file)**, PostgreSQL (Railway), Stripe Checkout/Webhooks/Portal, NextAuth (Google OAuth), Anthropic Claude API (extraction, column mapping, sample data), Resend (transactional email), Calendly (booking), Vercel hosting (custom domain `flowworks.it.com`), Vercel Cron (daily trial-expiring sweep).

**Styling architecture:** Mixed during the Phase 2 mobile-responsive migration. New and touched components use Tailwind utility classes (mobile-first responsive); untouched components retain inline `style={...}` objects backed by a per-file `s` const at file bottom. The `s` const at the bottom of a file is the visible signal of "still inline." Each file is fully one or fully the other — never mixed within a single file.

**Development workflow:** Claude Code (Opus 4.7) in VS Code terminal with Vercel MCP for deployment logs, GitHub for version control, notepad for emergency edits, `/api/test-email` diagnostic endpoint for Resend health checks.

---

## Competitive Landscape

QuickBooks $38–$275/mo (raised prices 15–25% May 2026). Xero $25–$90/mo. FreshBooks $19–$60/mo. Wave: free (fees on payments). FlowWork undercuts all paid competitors while offering AI-first automation none of them match. All tiers include a 14-day free trial.
