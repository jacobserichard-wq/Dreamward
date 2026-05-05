import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface PolicyDocumentProps {
  content: string;
}

export default function PolicyDocument({ content }: PolicyDocumentProps) {
  return (
    <div style={s.container}>
      <div style={s.inner}>
        <a href="/" style={s.backLink}>
          {"←"} Back to FlowWork
        </a>
        <div style={s.header}>
          <span style={s.logoIcon}>{"⚡"}</span>
          <span style={s.logoText}>FlowWork</span>
        </div>
        <article style={s.card}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 style={s.h1}>{children}</h1>,
              h2: ({ children }) => <h2 style={s.h2}>{children}</h2>,
              h3: ({ children }) => <h3 style={s.h3}>{children}</h3>,
              p: ({ children }) => <p style={s.p}>{children}</p>,
              ul: ({ children }) => <ul style={s.ul}>{children}</ul>,
              ol: ({ children }) => <ol style={s.ol}>{children}</ol>,
              li: ({ children }) => <li style={s.li}>{children}</li>,
              a: ({ children, href }) => (
                <a href={href} style={s.link} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
              strong: ({ children }) => <strong style={s.strong}>{children}</strong>,
              em: ({ children }) => <em style={s.em}>{children}</em>,
              hr: () => <hr style={s.hr} />,
              code: ({ children }) => <code style={s.code}>{children}</code>,
              table: ({ children }) => (
                <div style={s.tableWrap}>
                  <table style={s.table}>{children}</table>
                </div>
              ),
              th: ({ children }) => <th style={s.th}>{children}</th>,
              td: ({ children }) => <td style={s.td}>{children}</td>,
              blockquote: ({ children }) => <blockquote style={s.blockquote}>{children}</blockquote>,
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
        <div style={s.footer}>
          <a href="/privacy" style={s.footerLink}>Privacy</a>
          <span style={s.footerDot}>{"·"}</span>
          <a href="/terms" style={s.footerLink}>Terms</a>
          <span style={s.footerDot}>{"·"}</span>
          <a href="/" style={s.footerLink}>FlowWork</a>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    background: "#f8fafc",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "#0f172a",
  },
  inner: {
    maxWidth: 720,
    margin: "0 auto",
    padding: "32px 24px 64px",
  },
  backLink: {
    fontSize: 14,
    color: "#3b82f6",
    textDecoration: "none",
    display: "inline-block",
    marginBottom: 24,
  },
  header: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 24,
  },
  logoIcon: { fontSize: 28 },
  logoText: { fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.5px" },
  card: {
    background: "white",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    padding: "40px 44px",
  },
  h1: {
    fontSize: 28,
    fontWeight: 800,
    color: "#0f172a",
    margin: "0 0 16px",
    lineHeight: 1.2,
  },
  h2: {
    fontSize: 18,
    fontWeight: 700,
    color: "#0f172a",
    margin: "32px 0 12px",
    lineHeight: 1.3,
  },
  h3: {
    fontSize: 16,
    fontWeight: 700,
    color: "#0f172a",
    margin: "24px 0 8px",
  },
  p: {
    fontSize: 15,
    lineHeight: 1.65,
    color: "#334155",
    margin: "0 0 16px",
  },
  ul: {
    fontSize: 15,
    lineHeight: 1.65,
    color: "#334155",
    margin: "0 0 16px",
    paddingLeft: 24,
  },
  ol: {
    fontSize: 15,
    lineHeight: 1.65,
    color: "#334155",
    margin: "0 0 16px",
    paddingLeft: 24,
  },
  li: {
    margin: "0 0 6px",
  },
  link: {
    color: "#3b82f6",
    textDecoration: "underline",
  },
  strong: {
    fontWeight: 700,
    color: "#0f172a",
  },
  em: {
    fontStyle: "italic",
  },
  hr: {
    border: "none",
    borderTop: "1px solid #e2e8f0",
    margin: "32px 0",
  },
  code: {
    fontFamily: '"SF Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    background: "#f1f5f9",
    padding: "2px 6px",
    borderRadius: 4,
    color: "#0f172a",
  },
  tableWrap: {
    overflowX: "auto" as const,
    margin: "0 0 16px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 14,
  },
  th: {
    textAlign: "left" as const,
    padding: "10px 12px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    fontWeight: 600,
    color: "#0f172a",
  },
  td: {
    padding: "10px 12px",
    border: "1px solid #e2e8f0",
    color: "#334155",
    verticalAlign: "top" as const,
  },
  blockquote: {
    borderLeft: "3px solid #cbd5e1",
    margin: "0 0 16px",
    padding: "4px 16px",
    color: "#64748b",
    fontSize: 15,
    lineHeight: 1.65,
  },
  footer: {
    marginTop: 32,
    fontSize: 13,
    color: "#94a3b8",
    textAlign: "center" as const,
  },
  footerLink: {
    color: "#64748b",
    textDecoration: "none",
    margin: "0 8px",
  },
  footerDot: {
    color: "#cbd5e1",
  },
};
