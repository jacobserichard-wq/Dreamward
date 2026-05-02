"use client";

import { useState, useCallback, useEffect } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Email {
  id: string;
  subject: string;
  from: string;
  date: string;
  body: string;
  snippet: string;
  labels: string[];
}

interface ProcessedItem {
  id: string;
  vendor: string;
  invoiceNumber: string;
  amount: number;
  dueDate: string;
  status: "pending" | "overdue" | "paid" | "needs_review";
  category: "invoice" | "expense" | "ar_followup";
  confidence: number;
  rawEmailId: string;
  summary: string;
}

type Label = "Invoices" | "AR Follow Up" | "Expenses";
type Tab = "emails" | "processed" | "dashboard";

// ─── Component ───────────────────────────────────────────────────────────────

export default function Home() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [processedItems, setProcessedItems] = useState<ProcessedItem[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<Label>("Invoices");
  const [activeTab, setActiveTab] = useState<Tab>("emails");
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Load processed items from database on mount
  useEffect(() => {
    async function loadItems() {
      try {
        const res = await fetch("/api/items");
        if (!res.ok) return;
        const data = await res.json();
        const mapped = (data.items || []).map((item: any) => ({
          id: String(item.id),
          vendor: item.vendor,
          invoiceNumber: item.invoice_number || "",
          amount: parseFloat(item.amount) || 0,
          dueDate: item.due_date || "",
          status: item.status || "pending",
          category: item.category || "invoice",
          confidence: item.confidence || 0,
          rawEmailId: item.raw_email_id || "",
          summary: item.summary || "",
        }));
        setProcessedItems(mapped);
      } catch (err) {
        console.error("Failed to load items:", err);
      }
    }
    loadItems();
  }, []);

  // ─── Fetch emails by label ─────────────────────────────────────────────────

  const fetchEmails = useCallback(async (label: Label) => {
    setLoading(true);
    setError(null);
    setSelectedLabel(label);
    try {
      const res = await fetch(`/api/gmail?label=${encodeURIComponent(label)}`);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
      const data = await res.json();
      setEmails(data.messages || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch emails");
      setEmails([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Process emails with Claude ────────────────────────────────────────────

  const processWithAI = useCallback(async () => {
    if (emails.length === 0) {
      setError("Fetch emails first before processing");
      return;
    }
    setProcessing(true);
    setError(null);
    setSuccessMsg(null);

    const categoryMap: Record<Label, string> = {
      Invoices: "invoice",
      "AR Follow Up": "ar_followup",
      Expenses: "expense",
    };

    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emails,
          category: categoryMap[selectedLabel],
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `Processing failed: ${res.statusText}`);
      }

      const data = await res.json();
      setProcessedItems((prev) => [...data.results, ...prev]);
      setSuccessMsg(`Processed ${data.processed} items from ${selectedLabel}`);
      setActiveTab("processed");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "AI processing failed");
    } finally {
      setProcessing(false);
    }
  }, [emails, selectedLabel]);

  // ─── Update item status ────────────────────────────────────────────────────
  const updateStatus = useCallback(
    (id: string, newStatus: ProcessedItem["status"]) => {
      fetch("/api/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: Number(id), status: newStatus }),
      }).catch((err) => console.error("Status update failed:", err));
      setProcessedItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: newStatus } : item
        )
      );
    },
    []
  );

  // ─── Dashboard stats ──────────────────────────────────────────────────────

  const stats = {
    total: processedItems.length,
    pending: processedItems.filter((i) => i.status === "pending").length,
    overdue: processedItems.filter((i) => i.status === "overdue").length,
    needsReview: processedItems.filter((i) => i.status === "needs_review").length,
    paid: processedItems.filter((i) => i.status === "paid").length,
    totalAmount: processedItems.reduce((sum, i) => sum + i.amount, 0),
    overdueAmount: processedItems
      .filter((i) => i.status === "overdue")
      .reduce((sum, i) => sum + i.amount, 0),
    avgConfidence:
      processedItems.length > 0
        ? Math.round(
            processedItems.reduce((sum, i) => sum + i.confidence, 0) /
              processedItems.length
          )
        : 0,
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <h1 style={styles.logo}>
            <span style={styles.logoIcon}>⚡</span> FlowWork
          </h1>
          <p style={styles.tagline}>Accounting Automation</p>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav style={styles.nav}>
        {(["emails", "processed", "dashboard"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              ...styles.navTab,
              ...(activeTab === tab ? styles.navTabActive : {}),
            }}
          >
            {tab === "emails" && "📧 Emails"}
            {tab === "processed" && `📄 Processed (${processedItems.length})`}
            {tab === "dashboard" && "📊 Dashboard"}
          </button>
        ))}
      </nav>

      <main style={styles.main}>
        {/* Status messages */}
        {error && <div style={styles.errorBanner}>{error}</div>}
        {successMsg && <div style={styles.successBanner}>{successMsg}</div>}
// 
        {/* ── EMAILS TAB ── */}
        {activeTab === "emails" && (
          <>
            {/* Label selector + actions */}
            <div style={styles.toolbar}>
              <div style={styles.labelGroup}>
                {(["Invoices", "AR Follow Up", "Expenses"] as Label[]).map(
                  (label) => (
                    <button
                      key={label}
                      onClick={() => fetchEmails(label)}
                      style={{
                        ...styles.labelBtn,
                        ...(selectedLabel === label
                          ? styles.labelBtnActive
                          : {}),
                      }}
                    >
                      {label === "Invoices" && "📑"}
                      {label === "AR Follow Up" && "🔔"}
                      {label === "Expenses" && "💳"}{" "}
                      {label}
                    </button>
                  )
                )}
              </div>

              <button
                onClick={processWithAI}
                disabled={processing || emails.length === 0}
                style={{
                  ...styles.processBtn,
                  ...(processing || emails.length === 0
                    ? styles.processBtnDisabled
                    : {}),
                }}
              >
                {processing ? "⏳ Processing..." : "🤖 Process with AI"}
              </button>
            </div>

            {/* Email list */}
            {loading ? (
              <div style={styles.loadingState}>Loading emails...</div>
            ) : emails.length === 0 ? (
              <div style={styles.emptyState}>
                <p style={styles.emptyIcon}>📭</p>
                <p>Select a label above to fetch emails</p>
              </div>
            ) : (
              <div style={styles.emailList}>
                {emails.map((email) => (
                  <div key={email.id} style={styles.emailCard}>
                    <div style={styles.emailHeader}>
                      <span style={styles.emailFrom}>{email.from}</span>
                      <span style={styles.emailDate}>
                        {new Date(email.date).toLocaleDateString()}
                      </span>
                    </div>
                    <div style={styles.emailSubject}>{email.subject}</div>
                    <div style={styles.emailSnippet}>
                      {email.snippet || email.body?.substring(0, 120)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── PROCESSED TAB ── */}
        {activeTab === "processed" && (
          <>
            {processedItems.length === 0 ? (
              <div style={styles.emptyState}>
                <p style={styles.emptyIcon}>📋</p>
                <p>No processed items yet. Fetch emails and click Process with AI.</p>
              </div>
            ) : (
              <div style={styles.cardGrid}>
                {processedItems.map((item) => (
                  <div key={item.id} style={styles.itemCard}>
                    {/* Card header with status badge */}
                    <div style={styles.cardHeader}>
                      <span style={styles.vendorName}>{item.vendor}</span>
                      <span
                        style={{
                          ...styles.statusBadge,
                          ...statusStyle(item.status),
                        }}
                      >
                        {item.status.replace("_", " ")}
                      </span>
                    </div>

                    {/* Card body */}
                    <div style={styles.cardBody}>
                      <div style={styles.cardRow}>
                        <span style={styles.cardLabel}>Invoice #</span>
                        <span style={styles.cardValue}>
                          {item.invoiceNumber}
                        </span>
                      </div>
                      <div style={styles.cardRow}>
                        <span style={styles.cardLabel}>Amount</span>
                        <span style={styles.amountValue}>
                          ${item.amount.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                      <div style={styles.cardRow}>
                        <span style={styles.cardLabel}>Due Date</span>
                        <span style={styles.cardValue}>
                          {item.dueDate || "—"}
                        </span>
                      </div>
                      <div style={styles.cardRow}>
                        <span style={styles.cardLabel}>Category</span>
                        <span style={styles.cardValue}>{item.category}</span>
                      </div>
                      <div style={styles.cardRow}>
                        <span style={styles.cardLabel}>Confidence</span>
                        <span
                          style={{
                            ...styles.cardValue,
                            color:
                              item.confidence >= 80
                                ? "#16a34a"
                                : item.confidence >= 50
                                ? "#ca8a04"
                                : "#dc2626",
                          }}
                        >
                          {item.confidence}%
                        </span>
                      </div>
                    </div>

                    {/* Summary */}
                    <p style={styles.cardSummary}>{item.summary}</p>

                    {/* Status actions */}
                    <div style={styles.cardActions}>
                      {(
                        ["pending", "paid", "overdue", "needs_review"] as const
                      ).map((s) => (
                        <button
                          key={s}
                          onClick={() => updateStatus(item.id, s)}
                          style={{
                            ...styles.statusBtn,
                            ...(item.status === s
                              ? styles.statusBtnActive
                              : {}),
                          }}
                        >
                          {s === "pending" && "⏳"}
                          {s === "paid" && "✅"}
                          {s === "overdue" && "🚨"}
                          {s === "needs_review" && "👀"}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── DASHBOARD TAB ── */}
        {activeTab === "dashboard" && (
          <div style={styles.dashboard}>
            {/* Stat cards */}
            <div style={styles.statGrid}>
              <StatCard
                label="Total Items"
                value={stats.total}
                icon="📦"
                color="#3b82f6"
              />
              <StatCard
                label="Total Amount"
                value={`$${stats.totalAmount.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                })}`}
                icon="💰"
                color="#16a34a"
              />
              <StatCard
                label="Overdue"
                value={stats.overdue}
                sub={`$${stats.overdueAmount.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                })}`}
                icon="🚨"
                color="#dc2626"
              />
              <StatCard
                label="Avg Confidence"
                value={`${stats.avgConfidence}%`}
                icon="🎯"
                color="#8b5cf6"
              />
            </div>

            {/* Status breakdown */}
            <div style={styles.breakdownSection}>
              <h3 style={styles.sectionTitle}>Status Breakdown</h3>
              <div style={styles.breakdownGrid}>
                {[
                  {
                    label: "Pending",
                    count: stats.pending,
                    color: "#f59e0b",
                    icon: "⏳",
                  },
                  {
                    label: "Overdue",
                    count: stats.overdue,
                    color: "#dc2626",
                    icon: "🚨",
                  },
                  {
                    label: "Needs Review",
                    count: stats.needsReview,
                    color: "#6366f1",
                    icon: "👀",
                  },
                  {
                    label: "Paid",
                    count: stats.paid,
                    color: "#16a34a",
                    icon: "✅",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      ...styles.breakdownCard,
                      borderLeft: `4px solid ${item.color}`,
                    }}
                  >
                    <span style={styles.breakdownIcon}>{item.icon}</span>
                    <span style={styles.breakdownCount}>{item.count}</span>
                    <span style={styles.breakdownLabel}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {processedItems.length === 0 && (
              <div style={styles.emptyState}>
                <p style={styles.emptyIcon}>📊</p>
                <p>Process some emails to see dashboard data</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Stat Card Component ─────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: string;
  color: string;
}) {
  return (
    <div style={{ ...styles.statCard, borderTop: `3px solid ${color}` }}>
      <div style={styles.statIcon}>{icon}</div>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
      {sub && <div style={styles.statSub}>{sub}</div>}
    </div>
  );
}

// ─── Status badge colors ─────────────────────────────────────────────────────

function statusStyle(
  status: string
): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    pending: { background: "#fef3c7", color: "#92400e" },
    overdue: { background: "#fee2e2", color: "#991b1b" },
    paid: { background: "#dcfce7", color: "#166534" },
    needs_review: { background: "#e0e7ff", color: "#3730a3" },
  };
  return map[status] || {};
}

// ─── Inline Styles ───────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    background: "#f8fafc",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    background: "linear-gradient(135deg, #1e293b 0%, #334155 100%)",
    padding: "24px 32px",
    color: "white",
  },
  headerInner: { maxWidth: 1200, margin: "0 auto" },
  logo: { margin: 0, fontSize: 28, fontWeight: 700 },
  logoIcon: { fontSize: 24 },
  tagline: { margin: "4px 0 0", opacity: 0.7, fontSize: 14 },

  nav: {
    display: "flex",
    gap: 0,
    background: "white",
    borderBottom: "1px solid #e2e8f0",
    padding: "0 32px",
    maxWidth: 1200,
    margin: "0 auto",
  },
  navTab: {
    padding: "14px 24px",
    border: "none",
    background: "none",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
    color: "#64748b",
    borderBottom: "2px solid transparent",
    transition: "all 0.15s",
  },
  navTabActive: {
    color: "#1e293b",
    borderBottomColor: "#3b82f6",
  },

  main: { maxWidth: 1200, margin: "0 auto", padding: "24px 32px" },

  errorBanner: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    padding: "12px 16px",
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 14,
  },
  successBanner: {
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    color: "#166534",
    padding: "12px 16px",
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 14,
  },

  toolbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    flexWrap: "wrap" as const,
    gap: 12,
  },
  labelGroup: { display: "flex", gap: 8 },
  labelBtn: {
    padding: "10px 18px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "white",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    color: "#475569",
    transition: "all 0.15s",
  },
  labelBtnActive: {
    background: "#1e293b",
    color: "white",
    borderColor: "#1e293b",
  },
  processBtn: {
    padding: "10px 24px",
    borderRadius: 8,
    border: "none",
    background: "#16a34a",
    color: "white",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    transition: "all 0.15s",
  },
  processBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },

  loadingState: {
    textAlign: "center" as const,
    padding: 60,
    color: "#64748b",
    fontSize: 15,
  },
  emptyState: {
    textAlign: "center" as const,
    padding: 60,
    color: "#94a3b8",
    fontSize: 15,
  },
  emptyIcon: { fontSize: 48, marginBottom: 8 },

  emailList: { display: "flex", flexDirection: "column" as const, gap: 8 },
  emailCard: {
    background: "white",
    borderRadius: 10,
    padding: "16px 20px",
    border: "1px solid #e2e8f0",
    transition: "box-shadow 0.15s",
  },
  emailHeader: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  emailFrom: { fontSize: 13, fontWeight: 600, color: "#1e293b" },
  emailDate: { fontSize: 12, color: "#94a3b8" },
  emailSubject: { fontSize: 14, fontWeight: 500, color: "#334155", marginBottom: 4 },
  emailSnippet: { fontSize: 13, color: "#64748b", lineHeight: 1.4 },

  // Processed items
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
    gap: 16,
  },
  itemCard: {
    background: "white",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    overflow: "hidden",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px 12px",
    borderBottom: "1px solid #f1f5f9",
  },
  vendorName: { fontSize: 16, fontWeight: 700, color: "#0f172a" },
  statusBadge: {
    padding: "4px 10px",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  cardBody: { padding: "12px 20px" },
  cardRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "6px 0",
    borderBottom: "1px solid #f8fafc",
  },
  cardLabel: { fontSize: 13, color: "#64748b" },
  cardValue: { fontSize: 13, fontWeight: 500, color: "#1e293b" },
  amountValue: { fontSize: 15, fontWeight: 700, color: "#0f172a" },
  cardSummary: {
    padding: "8px 20px 12px",
    fontSize: 12,
    color: "#64748b",
    lineHeight: 1.5,
    margin: 0,
  },
  cardActions: {
    display: "flex",
    gap: 4,
    padding: "8px 16px 12px",
    borderTop: "1px solid #f1f5f9",
  },
  statusBtn: {
    flex: 1,
    padding: "6px",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    background: "white",
    cursor: "pointer",
    fontSize: 16,
    transition: "all 0.15s",
  },
  statusBtnActive: {
    background: "#f1f5f9",
    borderColor: "#94a3b8",
  },

  // Dashboard
  dashboard: {},
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 16,
    marginBottom: 32,
  },
  statCard: {
    background: "white",
    borderRadius: 12,
    padding: 24,
    textAlign: "center" as const,
    border: "1px solid #e2e8f0",
  },
  statIcon: { fontSize: 28, marginBottom: 8 },
  statValue: { fontSize: 28, fontWeight: 800, color: "#0f172a" },
  statLabel: { fontSize: 13, color: "#64748b", marginTop: 4 },
  statSub: { fontSize: 12, color: "#94a3b8", marginTop: 2 },

  breakdownSection: {},
  sectionTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: "#0f172a",
    marginBottom: 16,
  },
  breakdownGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 12,
  },
  breakdownCard: {
    background: "white",
    borderRadius: 10,
    padding: "16px 20px",
    display: "flex",
    alignItems: "center",
    gap: 12,
    border: "1px solid #e2e8f0",
  },
  breakdownIcon: { fontSize: 20 },
  breakdownCount: { fontSize: 24, fontWeight: 800, color: "#0f172a" },
  breakdownLabel: { fontSize: 13, color: "#64748b" },
};




