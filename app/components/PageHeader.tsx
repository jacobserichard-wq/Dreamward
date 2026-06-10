interface PageHeaderProps {
  /** href the back-link points to (e.g., "/" or "/admin").
   *  Optional since the Fable-5 audit: top-level pages under the
   *  global AppHeader omit it (the nav already covers navigation);
   *  detail pages + public pages keep it. */
  backHref?: string;
  /** label after the arrow (e.g., "Dreamward", "Admin") — the arrow is rendered internally */
  backLabel?: string;
  /** the page's h1 — string for plain text, ReactNode for headings with emoji prefixes */
  title: React.ReactNode;
  /** optional subtitle below the h1 */
  subtitle?: React.ReactNode;
  /** optional right-side content rendered next to the title (e.g., a status badge) */
  rightSlot?: React.ReactNode;
}

export default function PageHeader({
  backHref,
  backLabel,
  title,
  subtitle,
  rightSlot,
}: PageHeaderProps) {
  const titleBlock = (
    <div>
      <h1 className="text-3xl font-bold text-slate-900 mb-1">{title}</h1>
      {subtitle && <p className="text-sm text-slate-500 m-0">{subtitle}</p>}
    </div>
  );

  return (
    <div className="mb-8">
      {backHref && (
        <a
          href={backHref}
          className="text-sm text-blue-600 no-underline inline-block mb-3"
        >
          {"←"} Back to {backLabel}
        </a>
      )}
      {rightSlot ? (
        <div className="flex justify-between items-start flex-wrap gap-3">
          {titleBlock}
          {rightSlot}
        </div>
      ) : (
        titleBlock
      )}
    </div>
  );
}
