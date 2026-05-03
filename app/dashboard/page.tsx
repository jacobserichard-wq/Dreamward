import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSessionClient } from "@/lib/getClient";
import pool from "@/lib/db";

async function getDashboardData(clientId: number) {
  const [itemsResult, summaryResult] = await Promise.all([
    pool.query(
      `SELECT id, vendor, invoice_number, category, amount, status, due_date, processed_at 
       FROM processed_items 
       WHERE client_id = $1 
       ORDER BY processed_at DESC 
       LIMIT 10`,
      [clientId]
    ),
    pool.query(
      `SELECT 
         COUNT(*) as total_items,
         COUNT(*) FILTER (WHERE category = 'invoice') as invoices,
         COUNT(*) FILTER (WHERE category = 'expense') as expenses,
         COUNT(*) FILTER (WHERE status = 'pending') as pending,
         COUNT(*) FILTER (WHERE status = 'processed') as processed,
         COALESCE(SUM(amount) FILTER (WHERE category = 'invoice'), 0) as total_invoice_amount,
         COALESCE(SUM(amount) FILTER (WHERE category = 'expense'), 0) as total_expense_amount
       FROM processed_items 
       WHERE client_id = $1`,
      [clientId]
    ),
  ]);

  return {
    recentItems: itemsResult.rows,
    summary: summaryResult.rows[0],
  };
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    processed: "bg-emerald-100 text-emerald-800",
    failed: "bg-red-100 text-red-800",
    review: "bg-blue-100 text-blue-800",
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        colors[status] || "bg-gray-100 text-gray-800"
      }`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, string> = {
    starter: "bg-indigo-100 text-indigo-800",
    growth: "bg-purple-100 text-purple-800",
    pro: "bg-amber-100 text-amber-800",
    trial: "bg-gray-100 text-gray-800",
    canceled: "bg-red-100 text-red-800",
  };

  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${
        colors[plan] || "bg-gray-100 text-gray-800"
      }`}
    >
      {plan.charAt(0).toUpperCase() + plan.slice(1)}
    </span>
  );
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/api/auth/signin");
  }

  const client = await getSessionClient();
  const { recentItems, summary } = await getDashboardData(client.id);

  const stats = [
    {
      label: "Total Items",
      value: summary.total_items,
      icon: "\u{1F4CB}",
    },
    {
      label: "Invoices",
      value: summary.invoices,
      subtext: formatCurrency(summary.total_invoice_amount),
      icon: "\u{1F9FE}",
    },
    {
      label: "Expenses",
      value: summary.expenses,
      subtext: formatCurrency(summary.total_expense_amount),
      icon: "\u{1F4B0}",
    },
    {
      label: "Pending Review",
      value: summary.pending,
      icon: "\u231B",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1">
              {"Welcome back, "}{session.user?.name || session.user?.email}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <PlanBadge plan={client.plan} />
            {client.plan === "trial" && client.trial_ends_at && (
              <span className="text-sm text-gray-500">
                {"Trial ends "}{formatDate(client.trial_ends_at)}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-500">
                  {stat.label}
                </span>
                <span className="text-xl">{stat.icon}</span>
              </div>
              <p className="text-3xl font-bold text-gray-900">{stat.value}</p>
              {stat.subtext && (
                <p className="text-sm text-gray-500 mt-1">{stat.subtext}</p>
              )}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Recent Items
            </h2>
            <span className="text-sm text-gray-500">
              {summary.processed}{" of "}{summary.total_items}{" processed"}
            </span>
          </div>

          {recentItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Vendor
                    </th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Due Date
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {recentItems.map((item: any) => (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {item.vendor || "\u2014"}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 capitalize">
                        {item.category || "\u2014"}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {item.amount ? formatCurrency(item.amount) : "\u2014"}
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={item.status || "pending"} />
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {item.due_date ? formatDate(item.due_date) : "\u2014"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-6 py-12 text-center">
              <p className="text-gray-500 text-sm">
                {"No items processed yet. Connect your Gmail to start automatically processing invoices and expenses."}
              </p>
            </div>
          )}
        </div>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <a
            href="/emails"
            className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow group"
          >
            <h3 className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
              {"\u{1F4E7} Process Emails"}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {"Scan your inbox for new invoices and expenses"}
            </p>
          </a>
          <a
            href="/items"
            className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow group"
          >
            <h3 className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
              {"\u{1F4D1} View All Items"}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {"Review and manage all processed documents"}
            </p>
          </a>
          <a
            href="/settings"
            className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow group"
          >
            <h3 className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
              {"\u2699\uFE0F Settings"}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {"Manage your account, integrations, and billing"}
            </p>
          </a>
        </div>
      </main>
    </div>
  );
}
