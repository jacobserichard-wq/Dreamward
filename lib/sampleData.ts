export interface SampleItem {
  vendor: string;
  invoice_number: string;
  amount: number;
  due_date: string;
  status: "pending" | "overdue" | "paid" | "needs_review";
  category: "invoice" | "expense" | "ar_followup";
  confidence: number;
  summary: string;
}

function daysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

const marketplace: SampleItem[] = [
  { vendor: "Square", invoice_number: "SQ-2026-0418", amount: 47.85, due_date: daysFromToday(-12), status: "paid", category: "expense", confidence: 96, summary: "Monthly Square POS subscription and card processing fees for booth sales." },
  { vendor: "Etsy Seller Fees", invoice_number: "ETSY-MAY-26", amount: 312.40, due_date: daysFromToday(-3), status: "paid", category: "expense", confidence: 94, summary: "Listing, transaction, and payment processing fees for April orders." },
  { vendor: "Brimfield Antique Show", invoice_number: "BRIM-2026-S", amount: 425.00, due_date: daysFromToday(8), status: "pending", category: "expense", confidence: 92, summary: "Summer market booth rental — 10x10 space, three day weekend." },
  { vendor: "Uline", invoice_number: "ULN-8847291", amount: 186.74, due_date: daysFromToday(-5), status: "paid", category: "expense", confidence: 98, summary: "Shipping supplies: bubble mailers, tissue paper, kraft boxes." },
  { vendor: "Sarah M. (custom order)", invoice_number: "INV-1042", amount: 285.00, due_date: daysFromToday(-8), status: "overdue", category: "invoice", confidence: 88, summary: "Custom hand-stitched leather wallet — final balance after deposit." },
  { vendor: "Thompson Wedding", invoice_number: "INV-1045", amount: 640.00, due_date: daysFromToday(14), status: "pending", category: "invoice", confidence: 91, summary: "Set of 80 personalized ceramic favors for June 12 reception." },
  { vendor: "Local Coffee Co (wholesale)", invoice_number: "INV-1038", amount: 1240.00, due_date: daysFromToday(-22), status: "overdue", category: "invoice", confidence: 89, summary: "Wholesale order: 24 hand-thrown mugs at $52 each. Net 30 terms." },
  { vendor: "Fabric & Notions Warehouse", invoice_number: "FNW-44218", amount: 92.18, due_date: daysFromToday(-1), status: "paid", category: "expense", confidence: 95, summary: "Linen, thread, and cotton batting restock." },
  { vendor: "Made in Maine Market", invoice_number: "MMM-FALL26", amount: 175.00, due_date: daysFromToday(45), status: "pending", category: "expense", confidence: 90, summary: "Application + booth deposit for fall artisan market in Portland." },
  { vendor: "Instagram Ads", invoice_number: "META-26041", amount: 75.00, due_date: daysFromToday(-7), status: "paid", category: "expense", confidence: 97, summary: "Boosted reel for new spring collection — reached 12k accounts." },
  { vendor: "Holly G. (commission)", invoice_number: "INV-1048", amount: 420.00, due_date: daysFromToday(6), status: "pending", category: "invoice", confidence: 86, summary: "Custom embroidered baby blanket with name and birth stats." },
  { vendor: "USPS Click-N-Ship", invoice_number: "USPS-26-04", amount: 218.62, due_date: daysFromToday(-2), status: "paid", category: "expense", confidence: 99, summary: "April postage for 47 customer shipments." },
];

const freelance: SampleItem[] = [
  { vendor: "Acme Corp", invoice_number: "INV-2026-018", amount: 4500.00, due_date: daysFromToday(-15), status: "overdue", category: "invoice", confidence: 93, summary: "Q1 strategy consulting — 30 hours at $150/hr. Net 30, 15 days late." },
  { vendor: "Northwind Logistics", invoice_number: "INV-2026-021", amount: 2800.00, due_date: daysFromToday(11), status: "pending", category: "invoice", confidence: 95, summary: "April retainer — content strategy and editorial calendar." },
  { vendor: "Bluebird Studio", invoice_number: "INV-2026-022", amount: 1750.00, due_date: daysFromToday(-2), status: "pending", category: "ar_followup", confidence: 87, summary: "Brand voice workshop + deliverables. Invoice sent, no response yet." },
  { vendor: "Cascade Health", invoice_number: "INV-2026-019", amount: 6200.00, due_date: daysFromToday(-4), status: "paid", category: "invoice", confidence: 98, summary: "Website copy rewrite project — milestone 2 of 3." },
  { vendor: "Notion", invoice_number: "NTN-26-APR", amount: 16.00, due_date: daysFromToday(-9), status: "paid", category: "expense", confidence: 99, summary: "Pro plan monthly subscription." },
  { vendor: "Adobe Creative Cloud", invoice_number: "ADBE-260415", amount: 59.99, due_date: daysFromToday(-19), status: "paid", category: "expense", confidence: 99, summary: "All Apps subscription — monthly." },
  { vendor: "WeWork", invoice_number: "WW-MAY-2026", amount: 320.00, due_date: daysFromToday(2), status: "pending", category: "expense", confidence: 96, summary: "Hot desk membership — May." },
  { vendor: "Sterling & Co. Law", invoice_number: "STR-2026-04", amount: 850.00, due_date: daysFromToday(-1), status: "needs_review", category: "expense", confidence: 72, summary: "Contract review for new MSA template — billable hours unclear." },
  { vendor: "Greenfield Ventures", invoice_number: "INV-2026-023", amount: 3200.00, due_date: daysFromToday(20), status: "pending", category: "invoice", confidence: 94, summary: "Pitch deck overhaul — Series A fundraising materials." },
  { vendor: "LinkedIn Premium", invoice_number: "LI-PR-26", amount: 39.99, due_date: daysFromToday(-13), status: "paid", category: "expense", confidence: 97, summary: "Premium Business — monthly." },
  { vendor: "Rivers Tax Group", invoice_number: "RTG-2026-Q1", amount: 1100.00, due_date: daysFromToday(7), status: "pending", category: "expense", confidence: 91, summary: "Q1 estimated tax preparation and quarterly filing." },
];

const food: SampleItem[] = [
  { vendor: "Restaurant Depot", invoice_number: "RD-44719", amount: 642.18, due_date: daysFromToday(-1), status: "paid", category: "expense", confidence: 97, summary: "Weekly restock: protein, produce, dry goods, paper goods." },
  { vendor: "Sysco", invoice_number: "SYS-260428", amount: 1284.56, due_date: daysFromToday(8), status: "pending", category: "expense", confidence: 95, summary: "Bulk order: cooking oil, spice rubs, takeout containers." },
  { vendor: "City of Austin Permits", invoice_number: "COA-FT-2026", amount: 285.00, due_date: daysFromToday(18), status: "pending", category: "expense", confidence: 93, summary: "Annual mobile food vendor permit renewal." },
  { vendor: "Shell Fleet", invoice_number: "SHL-26-W17", amount: 312.44, due_date: daysFromToday(-6), status: "paid", category: "expense", confidence: 96, summary: "Fuel for week of April 21 — generator and truck." },
  { vendor: "AAA Propane Supply", invoice_number: "AAA-8841", amount: 156.00, due_date: daysFromToday(-3), status: "paid", category: "expense", confidence: 94, summary: "Two 40lb propane tank refills." },
  { vendor: "TechCrunch Disrupt (catering)", invoice_number: "INV-2026-014", amount: 3850.00, due_date: daysFromToday(-9), status: "overdue", category: "invoice", confidence: 89, summary: "Catered lunch service for 250 attendees — Day 1 of conference." },
  { vendor: "Rivera Wedding", invoice_number: "INV-2026-015", amount: 2400.00, due_date: daysFromToday(12), status: "pending", category: "invoice", confidence: 92, summary: "Late-night taco bar for 120 guests — June 6 booking, 50% deposit received." },
  { vendor: "South by Southwest LLC", invoice_number: "INV-2026-013", amount: 5200.00, due_date: daysFromToday(-25), status: "overdue", category: "invoice", confidence: 91, summary: "Festival vendor booth — three day food service. Awaiting final payment." },
  { vendor: "Block Inc (Square fees)", invoice_number: "SQ-260430", amount: 184.92, due_date: daysFromToday(-4), status: "paid", category: "expense", confidence: 98, summary: "Card processing fees for April — 2.6% + $0.10 per swipe." },
  { vendor: "Goodyear Commercial Tire", invoice_number: "GY-77182", amount: 920.00, due_date: daysFromToday(-7), status: "needs_review", category: "expense", confidence: 68, summary: "Truck tires — duplicate charge from credit card statement, needs verification." },
  { vendor: "MailChimp", invoice_number: "MC-26-04", amount: 35.00, due_date: daysFromToday(-12), status: "paid", category: "expense", confidence: 99, summary: "Email marketing — Standard plan, 2,400 subscribers." },
  { vendor: "Atlas Insurance", invoice_number: "ATL-FT-Q2", amount: 685.00, due_date: daysFromToday(22), status: "pending", category: "expense", confidence: 90, summary: "General liability + commercial auto — Q2 premium." },
];

const creative: SampleItem[] = [
  { vendor: "Hartley Wedding", invoice_number: "INV-2026-031", amount: 4200.00, due_date: daysFromToday(15), status: "pending", category: "invoice", confidence: 94, summary: "Full-day wedding photography package — June 21 booking, balance after deposit." },
  { vendor: "Mendoza Family Portraits", invoice_number: "INV-2026-029", amount: 685.00, due_date: daysFromToday(-3), status: "paid", category: "invoice", confidence: 96, summary: "Spring family session at Franklin Park — 30 edited images delivered." },
  { vendor: "Boutique Hotel Sandstone", invoice_number: "INV-2026-027", amount: 2800.00, due_date: daysFromToday(-12), status: "overdue", category: "invoice", confidence: 88, summary: "Property and lifestyle shoot — full library license, 60 final images." },
  { vendor: "B&H Photo", invoice_number: "BH-9924418", amount: 348.50, due_date: daysFromToday(-6), status: "paid", category: "expense", confidence: 98, summary: "Replacement 50mm prime lens after drop on last shoot." },
  { vendor: "SmugMug", invoice_number: "SM-PRO-26", amount: 360.00, due_date: daysFromToday(-30), status: "paid", category: "expense", confidence: 99, summary: "Annual portfolio + client gallery hosting." },
  { vendor: "Pictage Print Lab", invoice_number: "PCT-22184", amount: 124.80, due_date: daysFromToday(-2), status: "paid", category: "expense", confidence: 95, summary: "Album proofs and 8x10 prints for Mendoza session delivery." },
  { vendor: "Patel Engagement Shoot", invoice_number: "INV-2026-030", amount: 850.00, due_date: daysFromToday(4), status: "pending", category: "invoice", confidence: 92, summary: "Two-hour engagement session at Lincoln Park lakefront, May 10." },
  { vendor: "Adobe Creative Cloud", invoice_number: "ADBE-260418", amount: 59.99, due_date: daysFromToday(-16), status: "paid", category: "expense", confidence: 99, summary: "Photography plan — Lightroom + Photoshop." },
  { vendor: "PhotoShelter", invoice_number: "PSL-MAY26", amount: 49.99, due_date: daysFromToday(1), status: "pending", category: "expense", confidence: 97, summary: "Pro client gallery and archive hosting — monthly." },
  { vendor: "Lumi Studio Rental", invoice_number: "LUM-44721", amount: 220.00, due_date: daysFromToday(-1), status: "paid", category: "expense", confidence: 93, summary: "Half-day studio rental for headshot session — April 30." },
  { vendor: "Westbrook Branding Co", invoice_number: "INV-2026-028", amount: 1450.00, due_date: daysFromToday(-8), status: "needs_review", category: "ar_followup", confidence: 75, summary: "Headshot package for 12 staff. Client said check is in mail — confirm receipt." },
  { vendor: "Backblaze B2", invoice_number: "BB-260415", amount: 28.40, due_date: daysFromToday(-15), status: "paid", category: "expense", confidence: 98, summary: "Cloud backup for raw shoot archives — 6TB stored." },
];

const generic: SampleItem[] = [
  { vendor: "Office Depot", invoice_number: "OD-9942", amount: 84.50, due_date: daysFromToday(-5), status: "paid", category: "expense", confidence: 96, summary: "Office supplies: paper, ink cartridges, pens." },
  { vendor: "Comcast Business", invoice_number: "CB-MAY26", amount: 189.99, due_date: daysFromToday(3), status: "pending", category: "expense", confidence: 98, summary: "Business internet — 500/50 plan, monthly." },
  { vendor: "Acme Client LLC", invoice_number: "INV-2026-007", amount: 2400.00, due_date: daysFromToday(-10), status: "overdue", category: "invoice", confidence: 91, summary: "Services rendered — invoice sent, payment 10 days past due." },
  { vendor: "Gusto Payroll", invoice_number: "GST-260501", amount: 142.00, due_date: daysFromToday(-3), status: "paid", category: "expense", confidence: 99, summary: "Monthly payroll software — Core plan, 3 employees." },
  { vendor: "QuickBooks Online", invoice_number: "QB-26-04", amount: 65.00, due_date: daysFromToday(-19), status: "paid", category: "expense", confidence: 99, summary: "Essentials subscription — monthly accounting software." },
  { vendor: "Bright Horizons LLC", invoice_number: "INV-2026-008", amount: 1850.00, due_date: daysFromToday(7), status: "pending", category: "invoice", confidence: 89, summary: "April services per agreement — net 15 terms." },
  { vendor: "State Farm Business", invoice_number: "SF-26-Q2", amount: 425.00, due_date: daysFromToday(14), status: "pending", category: "expense", confidence: 94, summary: "Quarterly business insurance premium." },
  { vendor: "Costco Business", invoice_number: "CST-44820", amount: 318.42, due_date: daysFromToday(-2), status: "paid", category: "expense", confidence: 95, summary: "Bulk supply run — break room and shipping materials." },
  { vendor: "Zoom", invoice_number: "ZM-PRO-26", amount: 14.99, due_date: daysFromToday(-22), status: "paid", category: "expense", confidence: 99, summary: "Pro plan monthly subscription." },
  { vendor: "Hartwell Group", invoice_number: "INV-2026-009", amount: 950.00, due_date: daysFromToday(-6), status: "needs_review", category: "ar_followup", confidence: 70, summary: "Outstanding balance — partial payment received, follow up on remainder." },
  { vendor: "USPS", invoice_number: "USPS-260428", amount: 56.20, due_date: daysFromToday(-4), status: "paid", category: "expense", confidence: 97, summary: "Postage and shipping for April outgoing mail." },
];

const INDUSTRY_DATA: Record<string, SampleItem[]> = {
  marketplace,
  freelance,
  food,
  creative,
  other: generic,
};

export function getSampleData(industry: string): SampleItem[] {
  return INDUSTRY_DATA[industry] || generic;
}
