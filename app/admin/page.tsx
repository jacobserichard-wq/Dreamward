"use client";

import { useState, useEffect } from "react";

interface Client {
  id: number;
  email: string;
  business_name: string | null;
  industry: string | null;
  plan: string;
  stripe_customer_id: string | null;
  onboarding_completed: boolean;
  trial_ends_at: string | null;
  created_at: string;
  updated_at: string;
  total_items: string;
  items_this_month: string;
}

export default function AdminPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadAdmin() {
      try {
        const res = await fetch("/api/admin");
        if (res.status === 403) {
          setError("Access denied. Admin only.");
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error("Failed to load");
        const data = await res.json();
        setClients(data.clients || []);
      } catch (err) {
        setError("Failed to load admin data");
      } finally {
        setLoading(false);
      }
    }
    loadAdmin();
  }, []);

  if (loading) {
    return (
      <div style={s.container}>
        <div style={s.content}>
          <p style={s.loading}>Loading admin dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={s.container}>
        <div style={s.content}>
          <div style={s.errorCard}>
            <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>{"\u{1F6AB}"} Access Denied</h2>
            <p style={{ margin: 0, color: "#64748b" }}>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const totalRevenue = clients.reduce((sum, c) => {
    const prices: Record<string, number> = { starter: 19, growth: 49, pro: 89 };
    return sum + (prices[c.plan] || 0);
  }, 0);

  const planCounts = clients.reduce((acc, c) => {
    acc[c.plan] = (acc[c.plan] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div style={s.container}>
      <div style={s.content}>
        {/* Header */}
        <div style={s.header}>
          <a href="/" style={s.backLink}>{"\u2190"} Back to FlowWork</a>
          <h1 style={s.title}>{"\u{1F6E0}\uFE0F"} Admin Dashboard</h1>
          <p style={s.subtitle}>{clients.length} total clients</p>
        </div>

        {/* Summary Stats */}
        <div style={s.statGrid}>
          <div style={s.statCard}>
            <div style={s.statValue}>{clients.length}</div>
            <div style={s.statLabel}>Total Clients</div>
          </div>
          <div style={s.statCard}>
            <div style={s.statValue}>${totalRevenue}</div>
            <div style={s.statLabel}>Monthly Revenue</div>
          </div>
          <div style={s.statCard}>
            <div style={s.statValue}>{planCounts.trial || 0}</div>
            <div style={s.statLabel}>On Trial</div>
          </div>
          <div style={s.statCard}>
            <div style={s.statValue}>{(planCounts.starter || 0) + (planCounts.growth || 0) + (planCounts.pro || 0)}</div>
            <div style={s.statLabel}>Paying</div>
          </div>
        </div>

        {/* Client Table */}
        <div style={s.tableCard}>
          <div style={s.tableHeader}>
            <h2 style={s.tableTitle}>All Clients</h2>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Business</th>
                  <th style={s.th}>Email</th>
                  <th style={s.th}>Plan</th>
                  <th style={s.th}>Industry</th>
                  <th style={s.th}>Items</th>
                  <th style={s.th}>This Month</th>
                  <th style={s.th}>Onboarded</th>
                  <th style={s.th}>Joined</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id} style={s.tr}>
                    <td style={s.td}>
                      <span style={s.businessName}>{client.business_name || "\u2014"}</span>
                    </td>
                    <td style={s.td}>
                      <span style={s.email}>{client.email}</span>
                    </td>
                    <td style={s.td}>
                      <span style={{
                        ...s.planBadge,
                        ...(planStyle(client.plan)),
                      }}>
                        {client.plan}
                      </span>
                    </td>
                    <td style={s.td}>
                      <span style={s.industry}>{client.industry || "\u2014"}</span>
                    </td>
                    <td style={s.td}>{client.total_items}</td>
                    <td style={s.td}>{client.items_this_month}</td>
                    <td style={s.td}>
                      {client.onboarding_completed
                        ? <span style={s.checkYes}>{"\u2713"}</span>
                        : <span style={s.checkNo}>{"\u2717"}</span>
                      }
                    </td>
                    <td style={s.td}>
                      <span style={s.date}>
                        {client.created_at ? new Date(client.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "\u2014"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function planStyle(plan: string): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    trial: { background: "#f1f5f9", color: "#475569" },
    starter: { background: "#eff6ff", color: "#1d4ed8" },
    growth: { background: "#f3e8ff", color: "#7c3aed" },
    pro: { background: "#fef3c7", color: "#92400e" },
    canceled: { background: "#fee2e2", color: "#991b1b" },
  };
  return map[plan] || {};
}

const s: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    background: "#f8fafc",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  content: { maxWidth: 1100, margin: "0 auto", padding: "32px 24px" },
  header: { marginBottom: 32 },
  backLink: { fontSize: 14, color: "#3b82f6", textDecoration: "none", display: "inline-block", marginBottom: 12 },
  title: { fontSize: 28, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" },
  subtitle: { fontSize: 14, color: "#64748b", margin: 0 },
  loading: { textAlign: "center" as const, padding: 60, color: "#64748b" },
  errorCard: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 12,
    padding: "32px",
    textAlign: "center" as const,
    color: "#991b1b",
  },

  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 16,
    marginBottom: 32,
  },
  statCard: {
    background: "white",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    padding: "20px 24px",
  },
  statValue: { fontSize: 28, fontWeight: 800, color: "#0f172a" },
  statLabel: { fontSize: 13, color: "#64748b", marginTop: 4 },

  tableCard: {
    background: "white",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    overflow: "hidden",
  },
  tableHeader: {
    padding: "16px 24px",
    borderBottom: "1px solid #e2e8f0",
  },
  tableTitle: { fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 14,
  },
  th: {
    textAlign: "left" as const,
    padding: "12px 16px",
    fontSize: 12,
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
  },
  tr: {
    borderBottom: "1px solid #f1f5f9",
  },
  td: {
    padding: "14px 16px",
    color: "#334155",
  },
  businessName: { fontWeight: 600, color: "#0f172a" },
  email: { fontSize: 13, color: "#64748b" },
  planBadge: {
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.3px",
  },
  industry: { fontSize: 13, color: "#64748b", textTransform: "capitalize" as const },
  checkYes: { color: "#16a34a", fontWeight: 700 },
  checkNo: { color: "#dc2626", fontWeight: 700 },
  date: { fontSize: 13, color: "#64748b" },
};