import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface PolicyDocumentProps {
  content: string;
}

export default function PolicyDocument({ content }: PolicyDocumentProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <div className="max-w-[720px] mx-auto pt-8 px-4 pb-16 sm:px-6">
        <a
          href="/"
          className="text-sm text-blue-600 no-underline inline-block mb-6"
        >
          {"←"} Back to Dreamward
        </a>
        <div className="inline-flex items-center gap-2.5 mb-6">
          <span className="text-3xl">{"⚡"}</span>
          <span className="text-[22px] font-extrabold text-slate-900 tracking-tight">
            Dreamward
          </span>
        </div>
        <article className="bg-white rounded-xl border border-slate-200 py-8 px-5 sm:py-10 sm:px-11">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 className="text-3xl font-extrabold text-slate-900 mb-4 leading-[1.2]">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-lg font-bold text-slate-900 mt-8 mb-3 leading-tight">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-base font-bold text-slate-900 mt-6 mb-2">
                  {children}
                </h3>
              ),
              p: ({ children }) => (
                <p className="text-[15px] leading-[1.65] text-slate-700 mb-4">
                  {children}
                </p>
              ),
              ul: ({ children }) => (
                <ul className="text-[15px] leading-[1.65] text-slate-700 mb-4 pl-6 list-disc">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="text-[15px] leading-[1.65] text-slate-700 mb-4 pl-6 list-decimal">
                  {children}
                </ol>
              ),
              li: ({ children }) => <li className="mb-1.5">{children}</li>,
              a: ({ children, href }) => (
                <a
                  href={href}
                  className="text-blue-600 underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
              strong: ({ children }) => (
                <strong className="font-bold text-slate-900">{children}</strong>
              ),
              em: ({ children }) => <em className="italic">{children}</em>,
              hr: () => (
                <hr className="border-0 border-t border-slate-200 my-8" />
              ),
              code: ({ children }) => (
                <code className="font-mono text-[13px] bg-slate-100 py-0.5 px-1.5 rounded text-slate-900">
                  {children}
                </code>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto mb-4">
                  <table className="w-full border-collapse text-sm">
                    {children}
                  </table>
                </div>
              ),
              th: ({ children }) => (
                <th className="text-left py-2.5 px-3 bg-slate-50 border border-slate-200 font-semibold text-slate-900">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="py-2.5 px-3 border border-slate-200 text-slate-700 align-top">
                  {children}
                </td>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-[3px] border-slate-300 mb-4 py-1 px-4 text-slate-500 text-[15px] leading-[1.65]">
                  {children}
                </blockquote>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
        <div className="mt-8 text-[13px] text-slate-400 text-center">
          <a href="/privacy" className="text-slate-500 no-underline mx-2">
            Privacy
          </a>
          <span className="text-slate-300">{"·"}</span>
          <a href="/terms" className="text-slate-500 no-underline mx-2">
            Terms
          </a>
          <span className="text-slate-300">{"·"}</span>
          <a href="/" className="text-slate-500 no-underline mx-2">
            Dreamward
          </a>
        </div>
      </div>
    </div>
  );
}
