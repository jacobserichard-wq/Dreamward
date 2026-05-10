"use client";

import Spinner from "./Spinner";

type ReviewRow = {
  vendor: string;
  amount: number;
  due_date: string;
  category: string;
  confidence: number;
  _approved: boolean;
};

type UploadReview = {
  categories: string[];
};

type Props = {
  uploadReview: UploadReview | null;
  reviewRows: ReviewRow[];
  setReviewRows: (rows: ReviewRow[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
  importing: boolean;
};

export default function CsvReviewModal({
  uploadReview,
  reviewRows,
  setReviewRows,
  onCancel,
  onConfirm,
  importing,
}: Props) {
  if (!uploadReview) return null;

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.5)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 1000,
      padding: 20,
    }}>
      <div style={{
        background: "white", borderRadius: 16, maxWidth: 900,
        width: "100%", maxHeight: "85vh", overflow: "hidden",
        display: "flex", flexDirection: "column" as const,
      }}>
        <div style={{
          padding: "20px 24px", borderBottom: "1px solid #e2e8f0",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: "#0f172a" }}>
              Review Import ({reviewRows.filter((r) => r._approved).length} of {reviewRows.length} selected)
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
              Review categories and uncheck any rows you don&apos;t want to import.
            </p>
          </div>
          <button onClick={onCancel}
            style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#94a3b8" }}>
            &#x2715;
          </button>
        </div>
        <div style={{ overflow: "auto", flex: 1, padding: "0 24px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ position: "sticky" as const, top: 0, background: "white" }}>
                <th style={{ padding: "12px 8px", textAlign: "left" as const, borderBottom: "2px solid #e2e8f0", width: 40 }}>
                  <input type="checkbox"
                    checked={reviewRows.every((r) => r._approved)}
                    onChange={(e) =>
                      setReviewRows(reviewRows.map((r) => ({ ...r, _approved: e.target.checked })))
                    }
                  />
                </th>
                <th style={{ padding: "12px 8px", textAlign: "left" as const, borderBottom: "2px solid #e2e8f0" }}>Vendor</th>
                <th style={{ padding: "12px 8px", textAlign: "right" as const, borderBottom: "2px solid #e2e8f0" }}>Amount</th>
                <th style={{ padding: "12px 8px", textAlign: "left" as const, borderBottom: "2px solid #e2e8f0" }}>Date</th>
                <th style={{ padding: "12px 8px", textAlign: "left" as const, borderBottom: "2px solid #e2e8f0" }}>Category</th>
                <th style={{ padding: "12px 8px", textAlign: "center" as const, borderBottom: "2px solid #e2e8f0" }}>Conf.</th>
              </tr>
            </thead>
            <tbody>
              {reviewRows.map((row, i) => (
                <tr key={i} style={{ background: row._approved ? "white" : "#f8fafc" }}>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9" }}>
                    <input type="checkbox" checked={row._approved}
                      onChange={() =>
                        setReviewRows(reviewRows.map((r, j) => j === i ? { ...r, _approved: !r._approved } : r))
                      }
                    />
                  </td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9", fontWeight: 500 }}>
                    {row.vendor}
                  </td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9", textAlign: "right" as const, fontWeight: 600 }}>
                    ${(row.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9", color: "#64748b" }}>
                    {row.due_date || "-"}
                  </td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9" }}>
                    <select value={row.category}
                      onChange={(e) =>
                        setReviewRows(reviewRows.map((r, j) => j === i ? { ...r, category: e.target.value } : r))
                      }
                      style={{
                        padding: "4px 8px", borderRadius: 6, border: "1px solid #e2e8f0",
                        fontSize: 12, background: "white",
                      }}
                    >
                      {(uploadReview.categories || []).map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{
                    padding: "10px 8px", borderBottom: "1px solid #f1f5f9", textAlign: "center" as const,
                    color: row.confidence >= 80 ? "#16a34a" : row.confidence >= 50 ? "#ca8a04" : "#dc2626",
                    fontWeight: 600,
                  }}>
                    {row.confidence}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{
          padding: "16px 24px", borderTop: "1px solid #e2e8f0",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: 13, color: "#64748b" }}>
            {reviewRows.filter((r) => r._approved).length} rows will be imported
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onCancel}
              style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", fontSize: 14 }}>
              Cancel
            </button>
            <button onClick={onConfirm} disabled={importing}
              style={{
                padding: "10px 24px", borderRadius: 8, border: "none",
                background: "#16a34a", color: "white", cursor: "pointer",
                fontSize: 14, fontWeight: 600,
                display: "inline-flex", alignItems: "center", gap: 8,
                ...(importing ? { opacity: 0.5, cursor: "not-allowed" } : {}),
              }}>
              {importing && <Spinner size={14} color="white" />}
              {importing ? "Importing..." : `Import ${reviewRows.filter((r) => r._approved).length} Rows`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
