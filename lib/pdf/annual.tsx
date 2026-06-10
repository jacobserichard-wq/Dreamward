// lib/pdf/annual.tsx
//
// Phase 7b (PDF Export for Annual Tax Reports) commit 2 of 7, per
// session-notes/phase-7b-pdf-export-design.md §3.
//
// react-pdf component tree for the annual summary PDF. Pure
// presentational — takes an AnnualSummary (from lib/reports) and
// the user's business name; renders a single-page (auto-paginates
// when needed) Letter-size document.
//
// Why a separate file: keeps the @react-pdf/renderer import (and
// React + JSX runtime) out of lib/reports.ts so the JSON / CSV /
// dashboard fetcher paths don't pick up the dep. Only the two
// routes that actually render PDFs (commit 4 download + commit 5
// send) pull this file in via lib/reports.ts:renderAnnualPdf.
//
// Layout choices documented inline. Colors mirror the screen UI
// palette so the PDF visually relates to /reports even though the
// layouts differ.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { AnnualSummary } from "../reports";

// Letter, portrait, 0.5in margins. fontFamily Helvetica is a PDF-
// spec built-in — no Font.register, no font-load failure surface.
const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#0f172a",
    padding: 36, // 0.5in @ 72dpi
  },

  // Header band
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 1.5,
    borderBottomColor: "#1e293b",
    paddingBottom: 8,
    marginBottom: 14,
  },
  brand: { fontSize: 14, fontWeight: "bold" },
  yearTag: { fontSize: 10, color: "#475569" },
  title: { fontSize: 16, fontWeight: "bold", marginTop: 8 },
  subtitle: { fontSize: 10, color: "#475569", marginTop: 2, marginBottom: 14 },

  // Section card
  section: {
    marginBottom: 12,
    padding: 10,
    border: "1pt solid #e2e8f0",
    borderRadius: 4,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    marginBottom: 6,
    color: "#0f172a",
  },
  sectionTitleSmall: {
    fontSize: 9,
    fontWeight: "bold",
    marginBottom: 4,
    color: "#0f172a",
  },

  // Summary table rows
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  summaryRowTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 4,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#cbd5e1",
  },
  summaryLabel: { color: "#334155" },
  summaryValue: { textAlign: "right" },
  summaryValueTotal: { textAlign: "right", fontWeight: "bold" },

  // Two-column by-category
  twoCol: { flexDirection: "row", gap: 12 },
  col: { flex: 1 },
  catRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 1.5,
  },
  catName: { flex: 1, color: "#334155" },
  catAmount: { textAlign: "right", color: "#0f172a" },
  catCount: { fontSize: 8, color: "#94a3b8" },
  emptyMuted: { color: "#94a3b8", fontStyle: "italic" },

  // Notes
  notesItem: { color: "#475569", marginBottom: 3, lineHeight: 1.4 },

  // Footer
  footer: {
    marginTop: 14,
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: "#cbd5e1",
    fontSize: 8,
    color: "#94a3b8",
  },
});

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface AnnualPdfDocumentProps {
  summary: AnnualSummary;
  businessName: string;
}

export function AnnualPdfDocument({
  summary,
  businessName,
}: AnnualPdfDocumentProps) {
  const s = summary.summary;
  const ratePerMile = summary.mileage.rate.toFixed(2);
  const totalMiles = summary.mileage.totalMiles;

  // generatedAt is an ISO string from the server; format for human reading.
  const generatedAt = new Date(summary.generatedAt).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  // AR section renders only if there's any AR activity at all (matches the
  // /reports page's ReportArSnapshot which auto-hides on zero state).
  const hasAr =
    summary.ar.invoicesIssued > 0 ||
    summary.ar.invoicesPaid > 0 ||
    summary.ar.amountCollected > 0 ||
    summary.ar.outstandingAsOfYearEnd > 0;

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header — brand + year tag */}
        <View style={styles.header}>
          <Text style={styles.brand}>Dreamward</Text>
          <Text style={styles.yearTag}>Tax Year {summary.year}</Text>
        </View>
        <Text style={styles.title}>{businessName}</Text>
        <Text style={styles.subtitle}>
          Annual Business Summary — Cash Basis
        </Text>

        {/* Summary — Schedule-C-style P&L layout when COGS is
            non-zero. Conditional rendering avoids empty rows for
            service businesses that don't sell physical inventory.
            wrap={false} so this small fixed section never
            page-breaks mid-table. */}
        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Summary</Text>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Revenue</Text>
            <Text style={styles.summaryValue}>{fmtUsd(s.totalRevenue)}</Text>
          </View>
          {s.cogs > 0 && (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Cost of goods sold</Text>
                <Text style={styles.summaryValue}>{fmtUsd(s.cogs)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text
                  style={[styles.summaryLabel, { fontWeight: "bold" }]}
                >
                  Gross profit
                </Text>
                <Text
                  style={[styles.summaryValue, { fontWeight: "bold" }]}
                >
                  {fmtUsd(s.grossProfit)}
                </Text>
              </View>
            </>
          )}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>
              {s.cogs > 0 ? "Operating expenses" : "Expenses"}
            </Text>
            <Text style={styles.summaryValue}>
              {fmtUsd(s.cogs > 0 ? s.operatingExpenses : s.totalExpenses)}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Booth fees</Text>
            <Text style={styles.summaryValue}>{fmtUsd(s.boothFees)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>
              Mileage ({totalMiles.toFixed(1)} mi × ${ratePerMile})
            </Text>
            <Text style={styles.summaryValue}>{fmtUsd(s.mileageCost)}</Text>
          </View>

          <View style={styles.summaryRowTotal}>
            <Text style={styles.summaryLabel}>Net profit</Text>
            <Text style={styles.summaryValueTotal}>
              {fmtUsd(s.netProfit)}
            </Text>
          </View>
        </View>

        {/* By Category — two columns. NO wrap={false} since long
            expense lists may legitimately overflow to a second page. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>By Category</Text>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.sectionTitleSmall}>Income</Text>
              {summary.byCategory.income.length === 0 ? (
                <Text style={styles.emptyMuted}>None</Text>
              ) : (
                summary.byCategory.income.map((row) => (
                  <View key={row.category} style={styles.catRow}>
                    <View style={styles.catName}>
                      <Text>{row.category}</Text>
                      <Text style={styles.catCount}>
                        {row.count} {row.count === 1 ? "row" : "rows"}
                      </Text>
                    </View>
                    <Text style={styles.catAmount}>{fmtUsd(row.total)}</Text>
                  </View>
                ))
              )}
            </View>
            <View style={styles.col}>
              {/* Phase 13 polish: split the right column into a
                  "Cost of Goods Sold" subsection above
                  "Operating Expenses" when there are any COGS
                  rows. Keeps the visual consistent with the
                  Summary section above (which already separates
                  the two). When cogs === 0, the original single
                  "Expenses" list renders unchanged. */}
              {(() => {
                const cogsRows = summary.byCategory.expense.filter(
                  (r) => r.isCogs
                );
                const opexRows = summary.byCategory.expense.filter(
                  (r) => !r.isCogs
                );

                const renderRow = (row: typeof summary.byCategory.expense[number]) => {
                  // (D) suffix when taxDeductible === true; blank otherwise.
                  // No marker for false / null — keeps visual noise low and
                  // delegates ambiguity to the Notes section's blanket
                  // disclaimer. Less risky than asserting "not deductible"
                  // in a tax document.
                  const deductLabel =
                    row.taxDeductible === true ? " (D)" : "";
                  // Phase 7c: append the Schedule C line as a small
                  // suffix (e.g., "L18", "L20b"). Null when no mapping
                  // — render no suffix rather than a misleading
                  // placeholder.
                  const lineLabel = row.scheduleCLine
                    ? ` L${row.scheduleCLine}`
                    : "";
                  return (
                    <View key={row.category} style={styles.catRow}>
                      <View style={styles.catName}>
                        <Text>
                          {row.category}
                          {deductLabel}
                          {lineLabel}
                        </Text>
                        <Text style={styles.catCount}>
                          {row.count} {row.count === 1 ? "row" : "rows"}
                        </Text>
                      </View>
                      <Text style={styles.catAmount}>{fmtUsd(row.total)}</Text>
                    </View>
                  );
                };

                if (cogsRows.length === 0) {
                  return (
                    <>
                      <Text style={styles.sectionTitleSmall}>Expenses</Text>
                      {opexRows.length === 0 ? (
                        <Text style={styles.emptyMuted}>None</Text>
                      ) : (
                        opexRows.map(renderRow)
                      )}
                    </>
                  );
                }
                return (
                  <>
                    <Text style={styles.sectionTitleSmall}>
                      Cost of Goods Sold
                    </Text>
                    {cogsRows.map(renderRow)}
                    <Text style={[styles.sectionTitleSmall, { marginTop: 8 }]}>
                      Operating Expenses
                    </Text>
                    {opexRows.length === 0 ? (
                      <Text style={styles.emptyMuted}>None</Text>
                    ) : (
                      opexRows.map(renderRow)
                    )}
                  </>
                );
              })()}
            </View>
          </View>
        </View>

        {/* Phase 7c: Schedule C Summary section. Roll-up by IRS line
            number for the CPA's filing reference. Only renders if
            there's any expense activity that mapped to a line. */}
        {summary.scheduleCSummary.length > 0 && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Schedule C Summary</Text>
            <Text style={{ fontSize: 8, color: "#94a3b8", marginBottom: 6 }}>
              Expense totals grouped by IRS Schedule C Part II line.
              Cross-reference when filing.
            </Text>
            {summary.scheduleCSummary.map((row) => (
              <View key={row.line} style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>
                  Line {row.line} — {row.description}
                </Text>
                <Text style={styles.summaryValue}>{fmtUsd(row.total)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Phase 7c commit 10: Quarterly Estimates subsection. Only
            renders when an estimate was produced (net profit > 0).
            Mirrors the screen panel's content; layout follows the
            summary-row pattern for visual consistency with the rest
            of the PDF. wrap={false} keeps the block on one page. */}
        {summary.quarterlyEstimate && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>
              Quarterly Tax Estimates (Form 1040-ES)
            </Text>
            <Text style={{ fontSize: 8, color: "#94a3b8", marginBottom: 6 }}>
              Linear projection of YTD profit at{" "}
              {summary.quarterlyEstimate.effectivePct.toFixed(2)}% effective
              set-aside. Planning aid only — verify with your CPA.
            </Text>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>
                YTD set-aside ({summary.quarterlyEstimate.effectivePct.toFixed(2)}% of {fmtUsd(summary.quarterlyEstimate.ytdProfit)})
              </Text>
              <Text style={styles.summaryValue}>
                {fmtUsd(summary.quarterlyEstimate.ytdSetAside)}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>
                Projected annual profit ({summary.quarterlyEstimate.quartersElapsed} of 4 quarters elapsed)
              </Text>
              <Text style={styles.summaryValue}>
                {fmtUsd(summary.quarterlyEstimate.projectedAnnualProfit)}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Projected annual tax</Text>
              <Text style={styles.summaryValue}>
                {fmtUsd(summary.quarterlyEstimate.projectedAnnualTax)}
              </Text>
            </View>
            <View style={styles.summaryRowTotal}>
              <Text style={styles.summaryLabel}>Suggested per quarter</Text>
              <Text style={styles.summaryValueTotal}>
                {fmtUsd(summary.quarterlyEstimate.suggestedPerQuarter)}
              </Text>
            </View>

            <Text
              style={{
                fontSize: 9,
                fontWeight: "bold",
                marginTop: 8,
                marginBottom: 3,
                color: "#0f172a",
              }}
            >
              {summary.year} federal deadlines
            </Text>
            {summary.quarterlyEstimate.deadlines.map((d) => {
              const isNext = d.dueDate === summary.quarterlyEstimate?.nextDeadline;
              return (
                <View key={d.quarter} style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>
                    Q{d.quarter} — {d.dueDate}
                    {isNext ? "  (next)" : ""}
                  </Text>
                  <Text style={styles.summaryValue} />
                </View>
              );
            })}
          </View>
        )}

        {/* AR Snapshot — conditional on any AR activity. wrap={false}
            keeps the four-row block intact on a single page. */}
        {hasAr && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>AR Snapshot</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Invoices issued</Text>
              <Text style={styles.summaryValue}>
                {summary.ar.invoicesIssued}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Invoices paid</Text>
              <Text style={styles.summaryValue}>
                {summary.ar.invoicesPaid}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Amount collected</Text>
              <Text style={styles.summaryValue}>
                {fmtUsd(summary.ar.amountCollected)}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>
                Outstanding at {summary.year}-12-31
              </Text>
              <Text style={styles.summaryValue}>
                {fmtUsd(summary.ar.outstandingAsOfYearEnd)}
              </Text>
            </View>
          </View>
        )}

        {/* Inventory valuation — Form 1125-A beginning + ending
            inventory. Only when we have an ending value. */}
        {summary.inventoryValuation.ending !== null && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Inventory (Form 1125-A)</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Beginning inventory</Text>
              <Text style={styles.summaryValue}>
                {summary.inventoryValuation.beginning !== null
                  ? fmtUsd(summary.inventoryValuation.beginning)
                  : "—"}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>
                Ending inventory
                {summary.inventoryValuation.endingIsLive ? " (current)" : ""}
              </Text>
              <Text style={styles.summaryValue}>
                {fmtUsd(summary.inventoryValuation.ending)}
              </Text>
            </View>
          </View>
        )}

        {/* Notes — fixed disclaimers + conditional honesty notices.
            Conditional logic mirrors the on-screen /reports page so
            the PDF + screen never lie relative to each other. */}
        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Notes</Text>
          <Text style={styles.notesItem}>
            • Cash basis: income counted when received, expenses when paid.
          </Text>
          <Text style={styles.notesItem}>
            • Deductibility marker (D) on expense rows = federally
            tax-deductible per the Dreamward category taxonomy. Confirm
            with your CPA — timing and Section 179 elections may affect.
          </Text>
          <Text style={styles.notesItem}>
            • L&lt;number&gt; on expense rows and the Schedule C Summary
            section map to IRS Form 1040 Schedule C Part II line numbers.
            Defaults — verify mapping with your CPA before filing.
          </Text>
          {summary.quarterlyEstimate && (
            <Text style={styles.notesItem}>
              • Quarterly estimates are a planning aid based on linear
              projection of YTD profit at the configured tax bracket.
              They don&apos;t account for deductions, credits, prior-year
              safe harbors, state tax, or seasonality. Not tax advice —
              verify with your CPA before making payments.
            </Text>
          )}
          {summary.mileage.rateSource === "current-year-only" && (
            <Text style={styles.notesItem}>
              • Mileage rate (${ratePerMile}) is the current IRS rate. For
              prior-year filings, verify against the IRS rate for{" "}
              {summary.year}.
            </Text>
          )}
          {summary.mileage.rateSource === "fallback" && (
            <Text style={styles.notesItem}>
              • Mileage rate is a configuration fallback (${ratePerMile}/mi).
              Verify configuration before filing.
            </Text>
          )}
          {s.unknownAmount > 0 && (
            <Text style={styles.notesItem}>
              • {fmtUsd(s.unknownAmount)} in transactions had unclassified
              categories — excluded from totals. See the Dreamward dashboard
              to categorize.
            </Text>
          )}
        </View>

        {/* Footer — generated timestamp + source attribution +
            verify-before-filing disclaimer. Matches the CSV + the
            on-screen footer. */}
        <View style={styles.footer}>
          <Text>
            Generated {generatedAt} from Dreamward. Verify against source
            documents before filing.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

/**
 * Render the annual summary to a PDF Buffer for download / email
 * attachment. Wrapper around renderToBuffer that lives here (a .tsx
 * file) so the JSX type inference flows through correctly to
 * react-pdf's renderToBuffer signature — `React.createElement` in a
 * .ts file loses the ReactElement<DocumentProps> generic and fails
 * typecheck.
 *
 * Called from lib/reports.ts:renderAnnualPdf (commit 3), which is
 * the consumer the routes import.
 */
export async function renderAnnualPdfBuffer(
  summary: AnnualSummary,
  businessName: string
): Promise<Buffer> {
  return renderToBuffer(
    <AnnualPdfDocument summary={summary} businessName={businessName} />
  );
}
