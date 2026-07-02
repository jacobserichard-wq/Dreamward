// app/components/FaqSection.tsx
//
// Reusable FAQ block for marketing/comparison pages. Two jobs:
//   1. Visible accordion (native <details>, so it's a server component —
//      no client JS) answering the real questions people search.
//   2. Emits FAQPage JSON-LD matching the visible Q&A, which is eligible
//      for FAQ rich results and reinforces the page's topical intent.
//
// House rule: answers must be truthful. Keep the schema text identical
// to the rendered answer (Google requires the markup to match visible
// content).

interface Faq {
  q: string;
  a: string;
}

export default function FaqSection({
  title = "Frequently asked questions",
  faqs,
}: {
  title?: string;
  faqs: Faq[];
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <section className="max-w-[800px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
      <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-8 text-center">
        {title}
      </h2>
      <div className="flex flex-col gap-3">
        {faqs.map((f) => (
          <details
            key={f.q}
            className="group bg-cream border border-sand rounded-2xl px-5 py-4"
          >
            <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex justify-between items-center gap-4 font-semibold text-forest text-[15px] leading-snug">
              <span>{f.q}</span>
              <span className="text-eucalyptus text-2xl leading-none flex-shrink-0 transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="text-sm text-bark leading-relaxed mt-3 mb-0">{f.a}</p>
          </details>
        ))}
      </div>
      {/* FAQPage structured data — mirrors the accordion above verbatim. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </section>
  );
}
