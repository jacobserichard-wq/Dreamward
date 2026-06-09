"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "../components/PageHeader";
import ErrorBanner from "../components/ErrorBanner";
import EventHistoryList, { type EventSummary } from "../components/EventHistoryList";
import EventCreateForm, { type EventResponse } from "../components/EventCreateForm";
import { isPayingTier } from "@/lib/plans";

export default function EventsPage() {
  const router = useRouter();
  const [plan, setPlan] = useState<string | null>(null);
  const [events, setEvents] = useState<EventResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const loadEvents = useCallback(async () => {
    const res = await fetch("/api/events");
    if (res.status === 401) {
      router.replace("/signin?callbackUrl=/events");
      return;
    }
    if (res.status === 403) {
      // Starter — the page renders the upgrade prompt below.
      setEvents([]);
      return;
    }
    if (!res.ok) {
      setError(`Couldn't load events: HTTP ${res.status}`);
      return;
    }
    const data = await res.json();
    setEvents(data.events || []);
  }, [router]);

  useEffect(() => {
    async function load() {
      try {
        const clientRes = await fetch("/api/client");
        if (clientRes.status === 401) {
          router.replace("/signin?callbackUrl=/events");
          return;
        }
        if (!clientRes.ok) {
          setError(`Couldn't load account: HTTP ${clientRes.status}`);
          return;
        }
        const clientData = await clientRes.json();
        setPlan(clientData.plan);

        // Non-paying users see the upgrade prompt, not the list.
        // Under the feature-flat model, every paying tier gets
        // events — only canceled/non-subscribed users are gated.
        if (!isPayingTier(clientData.plan)) return;

        await loadEvents();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load page");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router, loadEvents]);

  // Deep-link support: /events?new=1 auto-opens the inline create
  // form. Read from window.location rather than useSearchParams to
  // avoid forcing a Suspense boundary on this already-client page.
  // The form still only renders for paying tiers (gated below);
  // non-paying users on ?new=1 see the upgrade prompt as usual.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      setShowCreateForm(true);
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">Loading events...</p>
        </div>
      </div>
    );
  }

  if (!isPayingTier(plan)) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/dashboard"
            backLabel="FlowWork"
            title="Events"
            subtitle="Track market days, fairs, and event sales"
          />
          <div className="bg-amber-50 border border-amber-200 rounded-xl py-8 px-6 text-center">
            <p className="text-base font-medium text-amber-900 m-0 mb-2">
              {"\u{1F512}"} Active subscription required
            </p>
            <p className="text-sm text-amber-800 m-0 mb-5 leading-relaxed">
              Start your subscription — from $10/mo — to track market events,
              log per-event sales, and auto-code uploaded transactions to the
              right event. Events are included on every tier.
            </p>
            <Link
              href="/billing"
              className="inline-block py-2.5 px-6 rounded-lg bg-amber-600 text-white text-sm font-semibold no-underline cursor-pointer"
            >
              View plans
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const summaries: EventSummary[] = events.map((e) => ({
    id: e.id,
    name: e.name,
    startDate: e.startDate,
    endDate: e.endDate,
    venue: e.venue,
    linkedCount: e.linkedTransactions?.count ?? 0,
    linkedTotal: e.linkedTransactions?.totalAmount ?? 0,
    totalMiles: e.totalMiles ?? null,
  }));

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/dashboard"
          backLabel="FlowWork"
          title="Events"
          subtitle="Track market days, fairs, and event sales"
        />

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <div className="flex justify-between items-center mb-5 gap-3 flex-wrap">
          <p className="text-sm text-slate-500 m-0">
            {events.length === 0
              ? "Add your first event to start tracking market days."
              : `${events.length} ${events.length === 1 ? "event" : "events"}`}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/profitability"
              className="py-2.5 px-5 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium no-underline"
            >
              {"\u{1F4CA}"} Profitability
            </Link>
            <button
              onClick={() => setShowCreateForm((prev) => !prev)}
              className="py-2.5 px-6 rounded-lg border-0 bg-blue-500 text-white text-sm font-semibold cursor-pointer"
            >
              {showCreateForm ? "Cancel" : "+ New event"}
            </button>
          </div>
        </div>

        {showCreateForm && (
          <EventCreateForm
            existingEvents={events}
            onCreated={(newEvent) => {
              // /api/events GET returns events sorted by start_date DESC, id
              // DESC. A new event is the most recent → prepend.
              setEvents((prev) => [newEvent, ...prev]);
              setShowCreateForm(false);
            }}
            onCancel={() => setShowCreateForm(false)}
          />
        )}

        <EventHistoryList events={summaries} />
      </div>
    </div>
  );
}
