/**
 * Industry-aware category taxonomies for AI classification.
 *
 * Universal core + per-industry overlay. UNIVERSAL_CATEGORIES contains
 * the 7 categories that appear in 3+ industries per the audit's cross-
 * industry analysis (Business Insurance, Software & SaaS, Marketing,
 * Payment Processing, Travel & Mileage, Equipment, Professional Services).
 * INDUSTRY_OVERLAY adds industry-specific categories without duplicating
 * the universal ones.
 *
 * Full design rationale: ./session-notes/audit-ai-classification.md.
 * Nonprofit functional classification (program/admin/fundraising) is
 * deferred per audit §10 Q3 — nonprofit categories here use the natural
 * axis like every other industry.
 */

// Industry slugs match app/onboarding/page.tsx INDUSTRIES.id exactly.
export type Industry =
  | "marketplace"
  | "freelance"
  | "service"
  | "food"
  | "ecommerce"
  | "creative"
  | "bookkeeper"
  | "nonprofit"
  | "realestate"
  | "fitness"
  | "other";

export type Category = {
  name: string;
  description: string;
  type: "income" | "expense";
  // Omit when ambiguous (e.g. partially deductible, depreciable, depends on context).
  taxDeductible?: boolean;
};

export const UNIVERSAL_CATEGORIES: Category[] = [
  {
    name: "Business Insurance",
    description:
      "General liability, professional liability, business owner's policy, equipment insurance, and other business-purpose insurance premiums.",
    type: "expense",
    taxDeductible: true,
  },
  {
    name: "Software & SaaS",
    description:
      "Business software subscriptions, cloud services, productivity tools, and recurring license fees.",
    type: "expense",
    taxDeductible: true,
  },
  {
    name: "Marketing & Advertising",
    description:
      "Paid ads, marketing campaigns, content production, brand and promotional materials.",
    type: "expense",
    taxDeductible: true,
  },
  {
    name: "Payment Processing Fees",
    description:
      "Credit card processing, payment platform fees (Stripe, Square, PayPal), and bank merchant fees.",
    type: "expense",
    taxDeductible: true,
  },
  {
    name: "Travel & Mileage",
    description:
      "Business travel (transportation, lodging), client trips, and vehicle mileage at IRS rate when no dedicated vehicle expense category applies.",
    type: "expense",
    taxDeductible: true,
  },
  {
    name: "Equipment",
    description:
      "Tools, equipment, and machinery purchased for business use. Items over the de minimis threshold are typically depreciated; smaller items immediately expensed.",
    type: "expense",
    // taxDeductible omitted — timing depends on cost and Section 179 election.
  },
  {
    name: "Professional Services",
    description:
      "Accountant, attorney, business consultant, and other professional fees paid for business purposes.",
    type: "expense",
    taxDeductible: true,
  },
];

export const INDUSTRY_OVERLAY: Record<Industry, Category[]> = {
  marketplace: [
    {
      name: "Booth & Show Fees",
      description:
        "Registration, application, and booth rental for markets, fairs, antique shows, and pop-ups.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Raw Materials & Inventory",
      description:
        "Yarn, leather, beads, clay, wood, fabric, and other inputs that become finished goods.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Packaging & Shipping Supplies",
      description:
        "Mailers, kraft boxes, tissue paper, branded inserts, address labels.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Marketplace & Listing Fees",
      description:
        "Etsy listing/transaction fees, Amazon FBA fees, Shopify subscriptions, and other platform fees beyond payment processing.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Event Sales",
      description:
        "Direct sales at markets, fairs, pop-ups, and in-person events.",
      type: "income",
    },
    {
      name: "Online Sales",
      description:
        "Etsy orders, Shopify orders, Instagram direct sales, custom orders.",
      type: "income",
    },
    {
      name: "Wholesale Orders",
      description: "Bulk orders to retail shops and B2B sales.",
      type: "income",
    },
  ],

  freelance: [
    {
      name: "Home Office",
      description:
        "Portion of rent, utilities, and internet attributable to dedicated business use; office furniture and setup.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Professional Development",
      description:
        "Courses, books, conference tickets, industry certifications, and continuing-education expenses.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Project Revenue",
      description:
        "Fixed-price project work, milestone-based billing, one-time engagement fees.",
      type: "income",
    },
    {
      name: "Retainer Revenue",
      description:
        "Recurring monthly retainers and ongoing contract revenue.",
      type: "income",
    },
    {
      name: "Hourly Billing",
      description:
        "Time-based work for clients on hourly engagement terms.",
      type: "income",
    },
  ],

  service: [
    {
      name: "Fuel & Vehicle Operating",
      description:
        "Gas, oil, fluids, and routine vehicle operating costs for company trucks and equipment.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Vehicle Maintenance & Repair",
      description:
        "Tires, brakes, major repairs, and scheduled maintenance for company vehicles.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Subcontractor Labor",
      description:
        "1099 contractors, day labor, and specialty subs (tree removal, irrigation).",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Materials & Plants",
      description:
        "Mulch, sod, seeds, fertilizer, edging, and hardscape materials.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Disposal & Dump Fees",
      description:
        "Yard waste disposal, debris removal, landfill fees.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Licenses & Permits",
      description:
        "Pesticide applicator license, business license, contractor permits.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "One-Time Jobs",
      description:
        "Single-visit residential or commercial work, project-based revenue.",
      type: "income",
    },
    {
      name: "Recurring Maintenance",
      description:
        "Weekly mowing, monthly landscaping contracts, ongoing-service revenue.",
      type: "income",
    },
  ],

  food: [
    {
      name: "Food & Beverage Inventory",
      description:
        "Wholesale food, beverages, and ingredients from restaurant supply.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Disposable Supplies",
      description:
        "Paper goods, takeout containers, napkins, utensils, cleaning supplies.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Fuel & Vehicle Operating",
      description:
        "Truck gas, generator fuel, oil changes.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Vehicle Maintenance & Repair",
      description:
        "Truck tires, mechanical repairs, kitchen equipment service.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Propane & Utilities",
      description:
        "Propane refills, commissary kitchen rental, water hookups.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Permits & Licenses",
      description:
        "Health permit, mobile vendor license, fire marshal inspection, business license.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Service Sales",
      description:
        "Daily food service at regular stops and walk-up customers.",
      type: "income",
    },
    {
      name: "Catering & Events",
      description:
        "Booked corporate, wedding, and private events.",
      type: "income",
    },
    {
      name: "Festival & Vendor Sales",
      description:
        "Multi-day festivals, fairs, conferences.",
      type: "income",
    },
  ],

  ecommerce: [
    {
      name: "Cost of Goods Sold (COGS)",
      description:
        "Raw materials, finished goods purchased to resell, manufacturing costs.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Marketplace & Platform Fees",
      description:
        "Etsy listing/transaction/payment fees, Amazon referral + FBA fees, Shopify subscription.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Shipping & Postage",
      description:
        "USPS, UPS, FedEx labels; shipping insurance; international customs fees.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Packaging Materials",
      description:
        "Boxes, polybags, dunnage, branded inserts, tape, address labels.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Photography & Branding",
      description:
        "Product photography, lifestyle shoots, design contractors, brand asset production.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Returns & Refunds",
      description:
        "Refunded sales, return shipping costs, restocking fees.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Marketplace Revenue",
      description: "Etsy + Amazon + eBay sales.",
      type: "income",
    },
    {
      name: "Direct Sales",
      description:
        "Own Shopify site, Instagram/TikTok Shop, direct customer orders.",
      type: "income",
    },
    {
      name: "Wholesale Orders",
      description: "Bulk orders to retail shops.",
      type: "income",
    },
  ],

  creative: [
    {
      name: "Cloud Storage & Backup",
      description:
        "Backblaze, SmugMug Pro, NAS drives, archival storage for raw shoots.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Studio Rental & Location Fees",
      description:
        "Hourly studio bookings, location permits, model release fees.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Second Shooters & Contractors",
      description:
        "1099 contractors per shoot, assistant photographers.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Albums & Print Lab",
      description:
        "Physical prints for clients, album orders, custom printing.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Wedding & Event Photography",
      description:
        "Full-day packages, engagement sessions.",
      type: "income",
    },
    {
      name: "Portrait & Family Sessions",
      description:
        "Family sessions, headshots, senior portraits.",
      type: "income",
    },
    {
      name: "Commercial & Licensing",
      description:
        "Brand shoots, stock licensing, product photography.",
      type: "income",
    },
  ],

  bookkeeper: [
    {
      name: "Continuing Education",
      description:
        "CPE credits, AICPA dues, industry-certification renewal.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Office Rent & Utilities",
      description:
        "Physical office space, dedicated business space, utilities.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Payroll & Contractor Labor",
      description:
        "Staff bookkeepers, junior CPAs, tax-season 1099 contractors.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Monthly Bookkeeping Retainers",
      description:
        "Recurring client bookkeeping services.",
      type: "income",
    },
    {
      name: "Tax Preparation",
      description:
        "1040, 1120-S, 1065, Schedule C, and other tax return preparation.",
      type: "income",
    },
    {
      name: "Advisory & Consulting",
      description:
        "Fractional CFO, financial planning, one-off consulting.",
      type: "income",
    },
  ],

  nonprofit: [
    // Natural-axis categories. Functional classification (Program / M&G /
    // Fundraising) is an orthogonal dimension; deferred per audit §10 Q3.
    {
      name: "Direct Mission Spending",
      description:
        "Direct mission-related expenses: scholarships, grants made to others, program materials, services delivered to beneficiaries.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Payroll & Employee Benefits",
      description:
        "Staff salaries, health insurance, payroll taxes, retirement contributions.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Office Rent & Utilities",
      description:
        "Facilities, internet, phone, shared workspace.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Individual Donations",
      description:
        "Small-dollar donations, online giving, recurring sustainers.",
      type: "income",
    },
    {
      name: "Grants",
      description:
        "Foundation, government, corporate grants.",
      type: "income",
    },
    {
      name: "Program Service Revenue",
      description:
        "Fees for service, event ticket sales, mission-aligned earned income.",
      type: "income",
    },
  ],

  realestate: [
    {
      name: "Mortgage Interest",
      description:
        "Interest portion of mortgage payments (not principal).",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Property Tax",
      description:
        "Annual or semi-annual property tax payments.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Property Insurance",
      description:
        "Homeowners, landlord, umbrella, flood insurance on rental properties.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Repairs & Maintenance",
      description:
        "Routine repairs (plumbing, HVAC service, painting, fixing broken items). Immediately deductible.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Capital Improvements",
      description:
        "Roof replacement, HVAC replacement, additions, major renovations. Depreciated over 27.5 years (residential) or 39 years (commercial), not immediately deductible.",
      type: "expense",
      // taxDeductible omitted — depreciable, not immediately deductible.
    },
    {
      name: "Property Management",
      description:
        "Third-party PM fees, leasing commissions, tenant screening.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "HOA & Utilities",
      description:
        "HOA dues, water/sewer when paid by owner, common-area electricity.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Rental Income",
      description:
        "Monthly rents collected from tenants.",
      type: "income",
    },
    {
      name: "Sale Proceeds",
      description:
        "Capital gains from property sales (net of basis and capital improvements).",
      type: "income",
    },
    {
      name: "Other Income",
      description:
        "Security-deposit forfeitures, late fees, laundry, parking, application fees.",
      type: "income",
    },
  ],

  fitness: [
    {
      name: "Certifications & Continuing Education",
      description:
        "NASM, ACE, NSCA renewals, continuing-education courses, industry certifications.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Gym Rent & Studio Space",
      description:
        "Independent training space rental, hourly studio use.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Music & Content Subscriptions",
      description:
        "Spotify Premium for classes, video editing software for online programs.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "1-on-1 Training",
      description:
        "Private session fees.",
      type: "income",
    },
    {
      name: "Group Programs",
      description:
        "Small-group training, bootcamps, classes.",
      type: "income",
    },
    {
      name: "Online Programs",
      description:
        "Digital coaching subscriptions, ebooks, video programs.",
      type: "income",
    },
  ],

  other: [
    // Generic fallback overlay — includes Payroll and Utilities since "Other"
    // serves as the catch-all for non-Pro clients without industry-specific lists.
    {
      name: "Cost of Goods Sold (COGS)",
      description:
        "Product costs for resale or inputs to manufactured goods.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Office Supplies",
      description:
        "Paper, pens, printer ink, small office items.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Payroll",
      description:
        "Employee salaries, wages, and payroll taxes.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Utilities",
      description:
        "Business-purpose electric, gas, water, internet, phone.",
      type: "expense",
      taxDeductible: true,
    },
    {
      name: "Service Revenue",
      description: "Service-based income.",
      type: "income",
    },
    {
      name: "Product Sales",
      description: "Product-based income.",
      type: "income",
    },
    {
      name: "Other Income",
      description:
        "Rental, royalty, miscellaneous earned income.",
      type: "income",
    },
  ],
};

/**
 * Returns the combined list of universal + industry-specific categories.
 */
export function getCategoriesForIndustry(industry: Industry): Category[] {
  return [...UNIVERSAL_CATEGORIES, ...(INDUSTRY_OVERLAY[industry] ?? [])];
}

/**
 * Convenience: bare name list for call sites (e.g. existing prompt strings)
 * that don't need the rich Category shape.
 */
export function getCategoryNamesForIndustry(industry: Industry): string[] {
  return getCategoriesForIndustry(industry).map((c) => c.name);
}
