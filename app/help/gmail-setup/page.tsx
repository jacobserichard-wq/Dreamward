"use client";

// app/help/gmail-setup/page.tsx
//
// Sub-session 24 follow-up commit 3 of 6. Gmail label setup guide
// for Pro users (and previewable by non-Pro users).
//
// Per the locked decision in the AskUserQuestion answer set:
//   - Gmail = Pro-only feature
//   - Help page = match Gmail gating
//
// Implementation choice: client-side plan check + upgrade banner
// for non-Pro users, rather than a server-side redirect. Matches
// the /reports page's existing Pro-gating pattern + lets non-Pro
// users preview the workflow when they click the "Preview the
// setup guide" link from the Emails-tab upgrade card. Better for
// evaluation; prospective Pro upgraders can see what they're
// paying for.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "../../components/PageHeader";
import AppHeader from "../../components/AppHeader";
import { FEATURES } from "@/lib/features";

interface ClientInfo {
  plan: string;
}

export default function GmailSetupGuidePage() {
  const router = useRouter();
  const [plan, setPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fable-5 audit: Gmail ingestion is hidden behind the feature
  // flag — a guide for a feature the user can't reach only
  // confuses. Redirect to the Help hub while the flag is off; the
  // page comes back automatically if GMAIL_INGEST flips to true.
  useEffect(() => {
    if (!FEATURES.GMAIL_INGEST) {
      router.replace("/help");
    }
  }, [router]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/client");
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const data = (await res.json()) as ClientInfo;
        setPlan(data.plan);
      } catch {
        // Non-fatal — the guide content still renders without a known plan.
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const isPro = plan === "pro";

  // While the redirect (flag off) is in flight, render nothing.
  if (!FEATURES.GMAIL_INGEST) return null;

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <AppHeader />
      <div className="max-w-[820px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/dashboard"
          backLabel="Dreamward"
          title="Gmail label setup"
          subtitle="Get Dreamward pulling invoices and expenses from your inbox in 5 minutes."
        />

        {/* Pro-required banner for non-Pro users. Renders only after
            the plan check completes (no flash of "Pro required" while
            loading). */}
        {!loading && !isPro && (
          <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl py-4 px-5 mb-6 flex items-start gap-3 flex-wrap">
            <div className="text-2xl flex-shrink-0">{"\u{1F512}"}</div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold m-0 mb-1">
                Gmail auto-fetch is a Pro feature
              </p>
              <p className="text-sm m-0 mb-3">
                You can preview the setup steps below to see what the
                workflow looks like, but you&apos;ll need to upgrade to Pro
                ($99/mo) to actually connect Gmail and run fetches.
              </p>
              <Link
                href="/billing"
                className="inline-block py-2 px-4 rounded-lg bg-amber-600 text-white text-sm font-semibold no-underline cursor-pointer"
              >
                View plans
              </Link>
            </div>
          </div>
        )}

        {/* ── STEP 1 ── */}
        <Section
          number={1}
          title="Create three labels in your Gmail account"
        >
          <p className="text-sm text-slate-600 mb-3">
            Dreamward looks for these exact label names in your Gmail.
            They&apos;re case-sensitive and must be top-level (not
            nested under another label).
          </p>
          <ul className="bg-white border border-slate-200 rounded-lg p-4 space-y-2 m-0 list-none">
            <LabelRow
              icon="\u{1F4D1}"
              name="Invoices"
              purpose="Bills you've received from vendors (the AP side — money you owe)."
            />
            <LabelRow
              icon="\u{1F514}"
              name="AR Follow Up"
              purpose="Invoices you've sent to your customers (the AR side — money owed to you)."
            />
            <LabelRow
              icon="\u{1F4B3}"
              name="Expenses"
              purpose="Receipts, subscription confirmations, anything else you spent money on."
            />
          </ul>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mt-3 text-sm text-slate-600">
            <strong className="text-slate-900">How to create a label:</strong>{" "}
            In Gmail (web), look at the left sidebar. Scroll to the
            bottom of your label list and click{" "}
            <strong>+ Create new label</strong>. Type the name exactly
            as shown above, leave &quot;Nest label under&quot;
            unchecked, and click <strong>Create</strong>. Repeat for
            each of the three labels.
          </div>
        </Section>

        {/* ── STEP 2 ── */}
        <Section
          number={2}
          title="Get emails into the right label"
        >
          <p className="text-sm text-slate-600 mb-3">
            You have two ways to apply labels — pick whichever fits
            your workflow:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="font-semibold text-slate-900 m-0 mb-1.5 text-sm">
                {"\u{1F446}"} Manual labeling (good for catching up)
              </p>
              <p className="text-xs text-slate-600 m-0">
                Search Gmail for past invoices (e.g.,{" "}
                <code className="bg-slate-100 px-1 rounded">
                  has:attachment invoice
                </code>
                ), select the matching emails, click the Labels icon
                in the toolbar, and apply the right Dreamward label.
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="font-semibold text-slate-900 m-0 mb-1.5 text-sm">
                {"\u{2699}"} Auto-labeling via filters (recommended)
              </p>
              <p className="text-xs text-slate-600 m-0">
                In Gmail → Settings → Filters and blocked addresses →
                Create a new filter. Match by sender (e.g.,{" "}
                <code className="bg-slate-100 px-1 rounded">
                  from:billing@*
                </code>
                ), then in &quot;Apply the label&quot; pick the right
                Dreamward label. Future emails get labeled automatically.
              </p>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
            <strong>Tip:</strong> Apply a filter to existing matching
            emails by checking{" "}
            <em>&quot;Also apply filter to matching conversations&quot;</em>{" "}
            when you create the filter. One-shot way to backfill years
            of invoices into the right label.
          </div>
        </Section>

        {/* ── STEP 3 ── */}
        <Section
          number={3}
          title="Pull labeled emails into Dreamward"
        >
          <p className="text-sm text-slate-600 mb-3">
            Once your labels exist and have at least one email in
            them:
          </p>
          <ol className="bg-white border border-slate-200 rounded-lg p-4 m-0 pl-6 space-y-2 text-sm text-slate-700">
            <li>
              In Dreamward, go to <strong>Home</strong> →{" "}
              <strong>Emails tab</strong>. You&apos;ll see one pill per
              label (Invoices, AR Follow Up, Expenses).
            </li>
            <li>
              Click a label pill. Dreamward fetches the most recent
              emails carrying that label and shows them in a list.
            </li>
            <li>
              Click <strong>Process with AI</strong>. Claude extracts
              the structured fields (vendor, invoice number, amount,
              due date) and categorizes each row by your industry.
            </li>
            <li>
              Review the results in the <strong>Processed</strong>{" "}
              tab. Items below 50% AI confidence are flagged in{" "}
              <strong>Needs Review</strong> so you can correct them
              before they hit your reports.
            </li>
            <li>
              Use <strong>Backfill</strong> (next to the label pills)
              to pull older emails — last 30 days through last year.
            </li>
          </ol>
        </Section>

        {/* ── TROUBLESHOOTING ── */}
        <Section number={4} title="Troubleshooting">
          <div className="space-y-3">
            <Troubleshoot
              q="The label pill doesn't return anything"
              a={
                <>
                  Most common cause: the label name doesn&apos;t match
                  exactly. Gmail is case-sensitive. Check that you
                  have <code>Invoices</code>{" "}
                  (capitalized), not <code>invoices</code> or{" "}
                  <code>Invoice</code>. Same for{" "}
                  <code>AR Follow Up</code> (three words, exact
                  spacing) and <code>Expenses</code>.
                </>
              }
            />
            <Troubleshoot
              q="I don't see any label pills"
              a={
                <>
                  Make sure you&apos;ve signed in with Google (top-
                  right → Sign in). Dreamward requests Gmail-readonly
                  access at sign-in time — if you skipped that consent
                  screen, sign out and sign back in.
                </>
              }
            />
            <Troubleshoot
              q="Process with AI says 'rate limited' or fails"
              a={
                <>
                  Anthropic API hiccup, usually transient. Wait a
                  minute and try again. If it keeps failing, the
                  emails are still safely labeled in Gmail — Dreamward
                  will pick them up on the next successful run.
                </>
              }
            />
            <Troubleshoot
              q="Can I use my own custom labels?"
              a={
                <>
                  Not in v1 — Dreamward only looks for{" "}
                  <code>Invoices</code>, <code>AR Follow Up</code>, and{" "}
                  <code>Expenses</code>. If you have an existing label
                  taxonomy, the cleanest path is to add a Gmail filter
                  that copies (not moves) matching emails into a
                  Dreamward label too.
                </>
              }
            />
          </div>
        </Section>

        <div className="text-center mt-8 pt-6 border-t border-slate-200">
          <Link
            href="/dashboard"
            className="text-sm text-blue-600 hover:underline"
          >
            {"\u{2190}"} Back to Dreamward
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Small section helper components ─────────────────────────────────────────

function Section({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-slate-900 m-0 mb-3 flex items-center gap-3">
        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-500 text-white text-sm font-bold flex items-center justify-center">
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function LabelRow({
  icon,
  name,
  purpose,
}: {
  icon: string;
  name: string;
  purpose: string;
}) {
  return (
    <li className="flex items-baseline gap-2.5">
      <span className="text-lg flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[13px] font-mono font-semibold text-slate-900">
          {name}
        </code>
        <span className="text-sm text-slate-600 ml-2">— {purpose}</span>
      </div>
    </li>
  );
}

function Troubleshoot({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <details className="bg-white border border-slate-200 rounded-lg p-3 group">
      <summary className="cursor-pointer text-sm font-medium text-slate-900 list-none flex items-center gap-2">
        <span className="text-slate-400 group-open:rotate-90 transition-transform">
          {"\u{25B6}"}
        </span>
        {q}
      </summary>
      <div className="text-sm text-slate-600 mt-2 pl-6 leading-relaxed">
        {a}
      </div>
    </details>
  );
}
