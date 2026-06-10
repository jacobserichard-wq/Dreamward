# Dreamward

**AI-powered accounting automation for small businesses.**

Dreamward ingests invoices and receipts from Gmail or CSV uploads, uses Claude to extract structured data + categorize transactions, tracks revenue + expenses + mileage across events, manages wholesale/consignment invoices with one-tap follow-up reminders, and generates annual tax summaries you can hand to your CPA — all in one place.

Live at **[godreamward.com](https://godreamward.com)**.

---

## Who it's for

Small-business operators who outgrew spreadsheets but don't want QuickBooks's complexity:

- Market vendors & craft sellers
- Freelancers & consultants
- Food trucks & mobile businesses
- Etsy / Amazon FBA sellers
- Small landscaping & service companies
- Photographers & creatives
- Bookkeepers & small CPA firms (often used on behalf of their own clients)

---

## What it does

**Smart intake.** Connect Gmail → Dreamward auto-fetches invoices and receipts by label. Or upload a CSV from Square, Stripe, QuickBooks, Xero, or Wave — Claude figures out the column mapping automatically. Duplicate detection prevents double-processing.

**AI extraction + classification.** Claude reads each document and extracts vendor, amount, due date, invoice number, plus a categorization tied to your industry's taxonomy (~87 categories across 11 industries).

**Events + mileage.** Track revenue per market day. Per-event P&L (revenue − booth fees − expenses − mileage). Google Maps Distance Matrix computes mileage automatically from your home address.

**AR aging.** Track wholesale/consignment invoices. Aging buckets (Current / 1–30 / 31–60 / 61–90 / 91+ days). Record payments (audit trail). Send polite follow-up reminders to overdue customers — one tap, Reply-To routes back to you.

**Annual tax reports.** Generate cash-basis annual summaries (Pro plan). Export as CSV (full ledger) or PDF (printable cover sheet). Email straight to your CPA with one click — both attachments, Reply-To set so their reply goes back to you.

---

## Pricing

"Built for people. Priced for people." Every paying tier gets every product feature — tiers are sized by your business's annual revenue, with automatic monthly tier reconciliation.

| Plan | Price | For businesses with annual revenue |
|---|---|---|
| **Dream** | $10/mo | under $5k |
| **Maker** | $19/mo | $5k–$50k |
| **Growth** | $49/mo | $50k–$500k |
| **Pro** | $99/mo | $500k+ |

14-day free trial on all tiers. No credit card required.

---

## Tech stack

- **Framework:** Next.js 16 (App Router), TypeScript
- **Styling:** Tailwind v4 (CSS-first config in `globals.css`, no `tailwind.config.*`)
- **Database:** PostgreSQL on Railway
- **Auth:** NextAuth + Google OAuth (Gmail-readonly scope for Pro tier)
- **Payments:** Stripe Checkout + Webhooks
- **AI:** Anthropic Claude API (extraction + categorization)
- **Email:** Resend (transactional + AR reminders + CPA handoff)
- **Maps:** Google Maps Distance Matrix (event mileage)
- **PDF:** @react-pdf/renderer (tax report generation)
- **Charts:** Recharts (profitability dashboard)
- **Hosting:** Vercel (custom domain `godreamward.com`, Vercel Cron for daily/weekly jobs)
- **Booking:** Calendly (Pro onboarding calls)

---

## Local development

### Prerequisites
- Node 20.6+ (uses `--env-file` flag for the migration runner)
- A PostgreSQL connection (the same Railway prod DB works for dev, or a local Postgres)

### Setup

```bash
# 1. Clone + install
git clone <this-repo>
cd dreamward
npm install

# 2. Copy the env template and fill in real values
cp .env.example .env.local
# Edit .env.local — see comments in the file for where to grab each value

# 3. Start the dev server
npm run dev
# Open http://localhost:3000
```

### Common commands

```bash
npm run dev          # Next.js dev server on :3000
npm run build        # Production build
npm run typecheck    # tsc --noEmit; CI-equivalent type check
npm run lint         # ESLint
```

### Database migrations

Migrations live in `db/migrations/` numbered sequentially (`0001_*.sql`, `0002_*.sql`, etc.). Apply them via the env-file-based runner — **not** Railway's web query console, which silently fails on multi-statement DDL:

```bash
node --env-file=.env.local scripts/run-migration.mjs db/migrations/0008_add_invoices_tables.sql
```

Each migration is idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). Safe to re-run.

### Deploys

- `master` branch → tracks `origin/main` → Vercel deploys on push.
- Push via `git push origin master:main` (deploy branch is `main`, not `master`).
- Vercel rebuilds + deploys in ~60–90 seconds after the push lands.

---

## Project structure

```
app/
  api/                   Server routes (Next 16 App Router)
    invoices/            Phase 6 AR tracking
    reports/annual/      Phase 7 tax reports (csv, pdf, send routes)
    events/              Phase 3 + 4 events + mileage
    stripe/              Checkout + webhook
    ... (gmail, upload, cron, settings, etc.)
  components/            Shared UI components (PageHeader, ErrorBanner, etc.)
  invoices/              /invoices pages (list, [id], new)
  events/                /events pages
  reports/               /reports tax reports page
  settings/              Settings UI
  page.tsx               Dashboard (the home / page)

lib/
  db.ts                  pg pool + low-level client helpers
  email.ts               Resend wrapper + per-template HTML
  reports.ts             Annual aggregation + CSV body assembly + PDF dispatcher
  pdf/annual.tsx         react-pdf component for tax report
  invoices.ts            Blessed payment write path (transactional)
  aging.ts               AR aging bucket derivation
  categories.ts          Industry-aware category taxonomy + taxDeductible flags
  ... (auth, distance, plans, classifier, etc.)

db/migrations/           Sequential SQL migrations (0001+)
scripts/                 One-off Node scripts (migration runner)
session-notes/           Per-sub-session audit/design/build artifacts (gitignored)
```

---

## Architecture notes

- **Tenant scoping.** Every DB query that touches client data carries `WHERE client_id = $1`. Tenant safety enforced at the query layer, not at a middleware boundary.
- **Plan gating.** Routes hard-code `isPlanAllowed(plan)` checks at the top of each handler. The canonical plan-feature mapping lives in `lib/plans.ts`.
- **Cash basis.** Tax reports use cash-basis accounting (income on receipt, expense on payment). Accrual is deferred.
- **Honesty flags.** Computed numbers carry source attribution (`rateSource: "config" | "fallback" | "current-year-only"`). UI surfaces a visible notice when a fabricated/fallback value is in play. Never let a fabricated number pass as a real configured one.
- **Atomic commits.** Multi-step features ship as atomic commits in sequence. Each commit typechecks clean before the next starts. See `session-notes/` for per-phase build cadence.

---

## Status

See [`ROADMAP.md`](./ROADMAP.md) for the full phase breakdown and current state. Phases 0 through 7b shipped as of May 2026; Phase 7c (Schedule C line mapping + quarterly estimates) is the next greenfield arc.
