"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
function ClientDetailContent() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("id");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) {
      setError("No client ID provided");
      setLoading(false);
      return;
    }
    async function load() {
      try {
        const res = await fetch(`/api/admin/client?id=${clientId}`);
        if (res.status === 403) { setError("Access denied"); setLoading(false); return; }
        if (!res.ok) throw new Error("Failed to load");
        const json = await res.json();
        setData(json);
      } catch { setError("Failed to load client"); }
      finally { setLoading(false); }
    }
    load();
  }, [clientId]);

  if (loading) return <div style={s.container}><div style={s.content}><p style={s.loading}>Loading client...</p></div></div>;
  if (error || !data) return <div style={s.container}><div style={s.content}><div style={s.errorCard}>{error || "Client not found"}</div></div></div>;

  const { client, settings, items, stats } = data;

  function fmt(amount: number) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  }

  function fmtDate(d: string) {
    return d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "\u2014";
  }

  return (
    <div style={s.container}>
      <div style={s.content}>
        {/* Header */}
        <div style={s.header}>
          <a href="/admin" style={s.backLink}>{"\u2190"} Back to Admin</a>
          <div style={s.headerRow}>
            <div>
              <h1 style={s.title}>{client.business_name || client.email}</h1>
              <p style={s.subtitle}>{client.email}</p>
            </div>
            <span style={{...s.planBadge, ...(planColor(client.plan))}}>{client.plan}</span>
          </div>
        </div>

        {/* Client Info Grid */}
        <div style={s.infoGrid}>
          <div style={s.infoCard}>
            <h3 style={s.infoTitle}>Account Details</h3>
            <div style={s.infoRow}><span style={s.infoLabel}>ID</span><span style={s.infoValue}>{client.id}</span></div>
            <div style={s.infoRow}><span style={s.infoLabel}>Industry</span><span style={s.infoValue}>{client.industry || "\u2014"}</span></div>
            <div style={s.infoRow}><span style={s.infoLabel}>Plan</span><span style={s.infoValue}>{client.plan}</span></div>
            <div style={s.infoRow}><span style={s.infoLabel}>Stripe ID</span><span style={s.infoValue}>{client.stripe_customer_id || "None"}</span></div>
            <div style={s.infoRow}><span style={s.infoLabel}>Onboarded</span><span style={s.infoValue}>{client.onboarding_completed ? "\u2713 Yes" : "\u2717 No"}</span></div>
            <div style={s.infoRow}><span style={s.infoLabel}>Joined</span><span style={s.infoValue}>{fmtDate(client.created_at)}</span></div>
            <div style={s.infoRow}><span style={s.infoLabel}>Trial Ends</span><span style={s.infoValue}>{fmtDate(client.trial_ends_at)}</span></div>
          </div>

          <div style={s.infoCard}>
            <h3 style={s.infoTitle}>Usage Stats</h3>
            <div style={s.infoRow}><span style={s.infoLabel}>Total Items</span><span style={s.infoValue}>{stats.total_items}</span></div>
            <div style={s.infoRow}><span style={s.infoLabel}>This Month</span><span style={s.infoValue}>{stats.items_this_month}</span></div>
            <div style={s.infoRow}><span style={s.infoLabel}>Pending</span><span style={s.infoValue}>{stats.pending}</span></div>
            <div style={s.infoRow}><span style={s.infoLabel}>Paid</span><span style={s.infoValue}>{stats.paid}</span></div>
            <div style={s.infoRow}><span style={s.infoLabel}>Overdue</span><span style={s.infoValue}>{stats.overdue}</span></div>
            <div style={s.infoRow}><span style={s.infoLabel}>Total Amount</span><span style={s.infoValue}>{fmt(parseFloat(stats.total_amount))}</span></div>
            <div style={s.infoRow}><span style={s.infoLabel}>Avg Confidence</span><span style={s.infoValue}>{Math.round(parseFloat(stats.avg_confidence))}%</span></div>
          </div>

          {settings && (
            <div style={s.infoCard}>
              <h3 style={s.infoTitle}>Settings</h3>
              <div style={s.infoRow}><span style={s.infoLabel}>Active Modules</span><span style={s.infoValue}>{settings.active_modules ? JSON.stringify(settings.active_modules) : "Default"}</span></div>
              <div style={s.infoRow}><span style={s.infoLabel}>Custom Categories</span><span style={s.infoValue}>{settings.custom_categories ? JSON.stringify(settings.custom_categories) : "None"}</span></div>
              <div style={s.infoRow}><span style={s.infoLabel}>Preferences</span><span style={s.infoValue}>{settings.preferences ? JSON.stringify(settings.preferences) : "Default"}</span></div>
            </div>
          )}
        </div>

        {/* Recent Items */}
        <div style={s.tableCard}>
          <div style={s.tableHeader}>
            <h2 style={s.tableTitle}>Recent Items ({items.length})</h2>
          </div>
          {items.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Vendor</th>
                    <th style={s.th}>Category</th>
                    <th style={s.th}>Amount</th>
                    <th style={s.th}>Status</th>
                    <th style={s.th}>Source</th>
                    <th style={s.th}>Confidence</th>
                    <th style={s.th}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any) => (
                    <tr key={item.id} style={s.tr}>
                      <td style={s.td}><span style={{ fontWeight: 600 }}>{item.vendor || "\u2014"}</span></td>
                      <td style={s.td}><span style={{ textTransform: "capitalize" as const }}>{item.category || "\u2014"}</span></td>
                      <td style={s.td}>{item.amount ? fmt(parseFloat(item.amount)) : "\u2014"}</td>
                      <td style={s.td}>
                        <span style={{...s.statusBadge, ...(statusColor(item.status))}}>
                          {item.status}
                        </span>
                      </td>
                      <td style={s.td}><span style={{ fontSize: 12, color: "#64748b" }}>{item.source || "email"}</span></td>
                      <td style={s.td}>{item.confidence ? `${item.confidence}%` : "\u2014"}</td>
                      <td style={s.td}><span style={{ fontSize: 13, color: "#64748b" }}>{fmtDate(item.processed_at)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: "center" as const, color: "#94a3b8" }}>No items yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

function planColor(plan: string): React.CSSProperties {
  const m: Record<string, React.CSSProperties> = {
    trial: { background: "#f1f5f9", color: "#475569" },
    starter: { background: "#eff6ff", color: "#1d4ed8" },
    growth: { background: "#f3e8ff", color: "#7c3aed" },
    pro: { background: "#fef3c7", color: "#92400e" },
    canceled: { background: "#fee2e2", color: "#991b1b" },
  };
  return m[plan] || {};
}

function statusColor(status: string): React.CSSProperties {
  const m: Record<string, React.CSSProperties> = {
    pending: { background: "#fef3c7", color: "#92400e" },
    paid: { background: "#dcfce7", color: "#166534" },
    overdue: { background: "#fee2e2", color: "#991b1b" },
    needs_review: { background: "#e0e7ff", color: "#3730a3" },
  };
  return m[status] || {};
}

const s: Record<string, React.CSSProperties> = {
  container: { minHeight: "100vh", background: "#f8fafc", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  content: { maxWidth: 1100, margin: "0 auto", padding: "32px 24px" },
  loading: { textAlign: "center" as const, padding: 60, color: "#64748b" },
  errorCard: { background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: 32, textAlign: "center" as const, color: "#991b1b" },
  header: { marginBottom: 32 },
  backLink: { fontSize: 14, color: "#3b82f6", textDecoration: "none", display: "inline-block", marginBottom: 12 },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" as const, gap: 12 },
  title: { fontSize: 28, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" },
  subtitle: { fontSize: 14, color: "#64748b", margin: 0 },
  planBadge: { padding: "6px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.5px", alignSelf: "flex-start" as const },

  infoGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 32 },
  infoCard: { background: "white", borderRadius: 12, border: "1px solid #e2e8f0", padding: "20px 24px" },
  infoTitle: { fontSize: 14, fontWeight: 600, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.5px", margin: "0 0 16px", paddingBottom: 12, borderBottom: "1px solid #f1f5f9" },
  infoRow: { display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f8fafc" },
  infoLabel: { fontSize: 13, color: "#64748b" },
  infoValue: { fontSize: 13, fontWeight: 500, color: "#0f172a" },

  tableCard: { background: "white", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" },
  tableHeader: { padding: "16px 24px", borderBottom: "1px solid #e2e8f0" },
  tableTitle: { fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 14 },
  th: { textAlign: "left" as const, padding: "12px 16px", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.5px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" },
  tr: { borderBottom: "1px solid #f1f5f9" },
  td: { padding: "12px 16px", color: "#334155" },
  statusBadge: { padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, textTransform: "uppercase" as const },
};
export default function ClientDetailPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ClientDetailContent />
    </Suspense>
  );
}