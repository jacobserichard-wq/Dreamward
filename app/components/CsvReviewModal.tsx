"use client";

import Spinner from "./Spinner";

type ReviewRow = {
  vendor: string;
  amount: number;
  due_date: string;
  category: string;
  confidence: number;
  // Phase 3 sub-session 17: auto-coded event for this row. Null when no
  // event matches (or matches multiple — design §8.8), or when the user
  // explicitly clears the assignment in the dropdown below.
  event_id: number | null;
  _approved: boolean;
};

type UploadReview = {
  categories: string[];
};

// Minimal event shape the modal needs. EventResponse[] from the page
// satisfies this via structural subtyping — extra fields are ignored.
type ModalEvent = {
  id: number;
  name: string;
};

type Props = {
  uploadReview: UploadReview | null;
  reviewRows: ReviewRow[];
  setReviewRows: (rows: ReviewRow[]) => void;
  // Available events for the per-row Event dropdown. Empty array hides
  // the column entirely (Starter clients + non-Starter clients with no
  // events yet — design §6 + §5.5).
  events: ModalEvent[];
  onCancel: () => void;
  onConfirm: () => void;
  importing: boolean;
};

export default function CsvReviewModal({
  uploadReview,
  reviewRows,
  setReviewRows,
  events,
  onCancel,
  onConfirm,
  importing,
}: Props) {
  if (!uploadReview) return null;
  const showEventColumn = events.length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-3 sm:p-5">
      <div className="bg-white rounded-2xl max-w-[900px] w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="py-5 px-6 border-b border-slate-200 flex justify-between items-center">
          <div>
            <h2 className="m-0 text-xl text-slate-900">
              Review Import ({reviewRows.filter((r) => r._approved).length} of {reviewRows.length} selected)
            </h2>
            <p className="mt-1 mb-0 mx-0 text-[13px] text-slate-500">
              Review categories and uncheck any rows you don&apos;t want to import.
            </p>
            {/* Format guidance at the recovery point: if the columns
                came through wrong, the user can grab the template and
                re-upload without hunting for it. */}
            <p className="mt-1.5 mb-0 mx-0 text-xs text-slate-400">
              Expected columns: Date {"\u{00B7}"} Customer/Vendor {"\u{00B7}"} Amount{" "}
              {"\u{00B7}"} Description {"\u{00B7}"} Category.{" "}
              <a
                href="/templates/dreamward-sales-template.csv"
                download="dreamward-sales-template.csv"
                className="text-blue-600 underline"
              >
                Download template
              </a>
            </p>
          </div>
          <button
            onClick={onCancel}
            className="bg-transparent text-2xl cursor-pointer text-slate-400"
          >
            &#x2715;
          </button>
        </div>
        <div className="overflow-auto flex-1 px-6">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="sticky top-0 bg-white">
                <th className="py-3 px-2 border-b-2 border-slate-200 text-left w-10">
                  <input
                    type="checkbox"
                    checked={reviewRows.every((r) => r._approved)}
                    onChange={(e) =>
                      setReviewRows(reviewRows.map((r) => ({ ...r, _approved: e.target.checked })))
                    }
                  />
                </th>
                <th className="py-3 px-2 border-b-2 border-slate-200 text-left">Vendor</th>
                <th className="py-3 px-2 border-b-2 border-slate-200 text-right">Amount</th>
                <th className="py-3 px-2 border-b-2 border-slate-200 text-left">Date</th>
                {showEventColumn && (
                  <th className="py-3 px-2 border-b-2 border-slate-200 text-left">Event</th>
                )}
                <th className="py-3 px-2 border-b-2 border-slate-200 text-left">Category</th>
                <th className="py-3 px-2 border-b-2 border-slate-200 text-center">Conf.</th>
              </tr>
            </thead>
            <tbody>
              {reviewRows.map((row, i) => (
                <tr key={i} className={row._approved ? "bg-white" : "bg-slate-50"}>
                  <td className="py-2.5 px-2 border-b border-slate-100">
                    <input
                      type="checkbox"
                      checked={row._approved}
                      onChange={() =>
                        setReviewRows(
                          reviewRows.map((r, j) =>
                            j === i ? { ...r, _approved: !r._approved } : r
                          )
                        )
                      }
                    />
                  </td>
                  <td className="py-2.5 px-2 border-b border-slate-100 font-medium">{row.vendor}</td>
                  <td className="py-2.5 px-2 border-b border-slate-100 text-right font-semibold">
                    ${(row.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-2.5 px-2 border-b border-slate-100 text-slate-500">
                    {row.due_date || "-"}
                  </td>
                  {showEventColumn && (
                    <td className="py-2.5 px-2 border-b border-slate-100">
                      <select
                        value={row.event_id == null ? "" : String(row.event_id)}
                        onChange={(e) => {
                          const newValue =
                            e.target.value === ""
                              ? null
                              : Number(e.target.value);
                          setReviewRows(
                            reviewRows.map((r, j) =>
                              j === i ? { ...r, event_id: newValue } : r
                            )
                          );
                        }}
                        className="py-1 px-2 rounded-md border border-slate-200 text-xs bg-white max-w-[160px]"
                      >
                        <option value="">— None</option>
                        {events.map((ev) => (
                          <option key={ev.id} value={String(ev.id)}>
                            {ev.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className="py-2.5 px-2 border-b border-slate-100">
                    <select
                      value={row.category}
                      onChange={(e) =>
                        setReviewRows(
                          reviewRows.map((r, j) =>
                            j === i ? { ...r, category: e.target.value } : r
                          )
                        )
                      }
                      className="py-1 px-2 rounded-md border border-slate-200 text-xs bg-white"
                    >
                      {(uploadReview.categories || []).map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td
                    className={`py-2.5 px-2 border-b border-slate-100 text-center font-semibold ${
                      row.confidence >= 80
                        ? "text-green-600"
                        : row.confidence >= 50
                        ? "text-yellow-600"
                        : "text-red-600"
                    }`}
                  >
                    {row.confidence}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="py-4 px-6 border-t border-slate-200 flex justify-between items-center">
          <span className="text-[13px] text-slate-500">
            {reviewRows.filter((r) => r._approved).length} rows will be imported
          </span>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="py-2.5 px-5 rounded-lg border border-slate-200 bg-white cursor-pointer text-sm"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={importing}
              className="py-2.5 px-6 rounded-lg bg-green-600 text-white cursor-pointer text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing && <Spinner size={14} color="white" />}
              {importing ? "Importing..." : `Import ${reviewRows.filter((r) => r._approved).length} Rows`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
