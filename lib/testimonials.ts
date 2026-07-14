// lib/testimonials.ts
//
// The landing page's social-proof section reads from this array and
// renders NOTHING while it's empty — the section auto-appears the
// moment the first entry lands here (decision: June 9, 2026 — build
// hidden until real quotes exist).
//
// HOUSE RULE — NO FABRICATED QUOTES, EVER. Every entry must be:
//   1. Actually said by a real person (tester, early user, customer)
//   2. Used with their explicit permission, including their name
//   3. Quoted faithfully — light trimming for length is fine,
//      changing the meaning is not
//
// To add one: append an object below, commit, deploy. That's it.
//
//   {
//     quote: "Dreamward finally told me which products actually make money.",
//     name: "Jane Doe",
//     business: "Willow & Wax Candle Co.",
//     location: "Indianapolis, IN",
//   },

export interface Testimonial {
  /** Their words, faithfully. Keep to 1–3 sentences. */
  quote: string;
  /** Real name, with permission. */
  name: string;
  /** Their shop/business name — the credibility anchor. */
  business?: string;
  /** "City, ST" — optional, adds texture. */
  location?: string;
}

export const TESTIMONIALS: Testimonial[] = [
  // Victoria — received via text 2026-07-08, written by her explicitly
  // for Dreamward's use ("more than happy to add anything!"). Faithful
  // excerpt of her longer review; connectors trimmed, meaning intact.
  {
    quote:
      "Dreamward has allowed me to focus on what I love most—growing my business—instead of getting buried in tedious spreadsheets and trackers. I can easily track sales, monitor profits, manage expenses, and see exactly how my business is performing—all in one place. Dreamward is what every small business owner NEEDS!",
    name: "Victoria",
    business: "Sweet to the Soul",
  },
];
