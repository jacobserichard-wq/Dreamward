// Payments table on /invoices/[id]. Pure presentational; parent owns
// the delete handler and any double-confirm modal.

interface PaymentEntry {
  id: number;
  amount: number;
  paidAt: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
}

interface PaymentHistoryTableProps {
  payments: PaymentEntry[];
  onDelete: (paymentId: number) => void;
  deletingPaymentId: number | null;
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function PaymentHistoryTable({
  payments,
  onDelete,
  deletingPaymentId,
}: PaymentHistoryTableProps) {
  if (payments.length === 0) {
    return (
      <p className="text-sm text-slate-500 italic m-0">
        No payments recorded yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left font-medium text-slate-600 py-2 px-3">
              Date
            </th>
            <th className="text-right font-medium text-slate-600 py-2 px-3">
              Amount
            </th>
            <th className="text-left font-medium text-slate-600 py-2 px-3">
              Method
            </th>
            <th className="text-left font-medium text-slate-600 py-2 px-3">
              Reference
            </th>
            <th className="text-left font-medium text-slate-600 py-2 px-3">
              Notes
            </th>
            <th className="text-right font-medium text-slate-600 py-2 px-3">
              {/* delete column */}
            </th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => {
            const isDeleting = deletingPaymentId === p.id;
            return (
              <tr
                key={p.id}
                className="border-b border-slate-100 last:border-b-0"
              >
                <td className="py-2 px-3 text-slate-700">{p.paidAt}</td>
                <td className="py-2 px-3 text-right font-medium text-slate-900">
                  {formatUsd(p.amount)}
                </td>
                <td className="py-2 px-3 text-slate-700">
                  {p.method || <span className="text-slate-400">—</span>}
                </td>
                <td className="py-2 px-3 text-slate-700">
                  {p.reference || <span className="text-slate-400">—</span>}
                </td>
                <td className="py-2 px-3 text-slate-600 max-w-[200px] truncate">
                  {p.notes || <span className="text-slate-400">—</span>}
                </td>
                <td className="py-2 px-3 text-right">
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => onDelete(p.id)}
                    title="Delete this payment"
                    className="text-xs text-red-600 hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isDeleting ? "Removing..." : "Remove"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
