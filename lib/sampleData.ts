export interface SampleItem {
  vendor: string;
  invoice_number: string;
  amount: number;
  due_date: string;
  status: "pending" | "overdue" | "paid" | "needs_review";
  category: string;
  confidence: number;
  summary: string;
}

function daysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

const marketplace: SampleItem[] = [
  { vendor: "Square", invoice_number: "SQ-2026-0418", amount: 47.85, due_date: daysFromToday(-12), status: "paid", category: "Payment Processing Fees", confidence: 96, summary: "Monthly Square POS subscription and card processing fees for booth sales." },
  { vendor: "Etsy Seller Fees", invoice_number: "ETSY-MAY-26", amount: 312.40, due_date: daysFromToday(-3), status: "paid", category: "Marketplace & Listing Fees", confidence: 94, summary: "Listing, transaction, and payment processing fees for April orders." },
  { vendor: "Brimfield Antique Show", invoice_number: "BRIM-2026-S", amount: 425.00, due_date: daysFromToday(8), status: "pending", category: "Booth & Show Fees", confidence: 92, summary: "Summer market booth rental — 10x10 space, three day weekend." },
  { vendor: "Uline", invoice_number: "ULN-8847291", amount: 186.74, due_date: daysFromToday(-5), status: "paid", category: "Packaging & Shipping Supplies", confidence: 98, summary: "Shipping supplies: bubble mailers, tissue paper, kraft boxes." },
  { vendor: "Sarah M. (custom order)", invoice_number: "INV-1042", amount: 285.00, due_date: daysFromToday(-8), status: "overdue", category: "Online Sales", confidence: 88, summary: "Custom hand-stitched leather wallet — final balance after deposit." },
  { vendor: "Thompson Wedding", invoice_number: "INV-1045", amount: 640.00, due_date: daysFromToday(14), status: "pending", category: "Online Sales", confidence: 91, summary: "Set of 80 personalized ceramic favors for June 12 reception." },
  { vendor: "Local Coffee Co (wholesale)", invoice_number: "INV-1038", amount: 1240.00, due_date: daysFromToday(-22), status: "overdue", category: "Wholesale Orders", confidence: 89, summary: "Wholesale order: 24 hand-thrown mugs at $52 each. Net 30 terms." },
  { vendor: "Fabric & Notions Warehouse", invoice_number: "FNW-44218", amount: 92.18, due_date: daysFromToday(-1), status: "paid", category: "Raw Materials & Inventory", confidence: 95, summary: "Linen, thread, and cotton batting restock." },
  { vendor: "Made in Maine Market", invoice_number: "MMM-FALL26", amount: 175.00, due_date: daysFromToday(45), status: "pending", category: "Booth & Show Fees", confidence: 90, summary: "Application + booth deposit for fall artisan market in Portland." },
  { vendor: "Instagram Ads", invoice_number: "META-26041", amount: 75.00, due_date: daysFromToday(-7), status: "paid", category: "Marketing & Advertising", confidence: 97, summary: "Boosted reel for new spring collection — reached 12k accounts." },
  { vendor: "Holly G. (commission)", invoice_number: "INV-1048", amount: 420.00, due_date: daysFromToday(6), status: "pending", category: "Online Sales", confidence: 86, summary: "Custom embroidered baby blanket with name and birth stats." },
  { vendor: "USPS Click-N-Ship", invoice_number: "USPS-26-04", amount: 218.62, due_date: daysFromToday(-2), status: "paid", category: "Packaging & Shipping Supplies", confidence: 99, summary: "April postage for 47 customer shipments." },
];

const freelance: SampleItem[] = [
  { vendor: "Acme Corp", invoice_number: "INV-2026-018", amount: 4500.00, due_date: daysFromToday(-15), status: "overdue", category: "Hourly Billing", confidence: 93, summary: "Q1 strategy consulting — 30 hours at $150/hr. Net 30, 15 days late." },
  { vendor: "Northwind Logistics", invoice_number: "INV-2026-021", amount: 2800.00, due_date: daysFromToday(11), status: "pending", category: "Retainer Revenue", confidence: 95, summary: "April retainer — content strategy and editorial calendar." },
  { vendor: "Bluebird Studio", invoice_number: "INV-2026-022", amount: 1750.00, due_date: daysFromToday(-2), status: "pending", category: "Project Revenue", confidence: 87, summary: "Brand voice workshop + deliverables. Invoice sent, no response yet." },
  { vendor: "Cascade Health", invoice_number: "INV-2026-019", amount: 6200.00, due_date: daysFromToday(-4), status: "paid", category: "Project Revenue", confidence: 98, summary: "Website copy rewrite project — milestone 2 of 3." },
  { vendor: "Notion", invoice_number: "NTN-26-APR", amount: 16.00, due_date: daysFromToday(-9), status: "paid", category: "Software & SaaS", confidence: 99, summary: "Pro plan monthly subscription." },
  { vendor: "Adobe Creative Cloud", invoice_number: "ADBE-260415", amount: 59.99, due_date: daysFromToday(-19), status: "paid", category: "Software & SaaS", confidence: 99, summary: "All Apps subscription — monthly." },
  { vendor: "WeWork", invoice_number: "WW-MAY-2026", amount: 320.00, due_date: daysFromToday(2), status: "pending", category: "Home Office", confidence: 96, summary: "Hot desk membership — May." },
  { vendor: "Sterling & Co. Law", invoice_number: "STR-2026-04", amount: 850.00, due_date: daysFromToday(-1), status: "needs_review", category: "Professional Services", confidence: 72, summary: "Contract review for new MSA template — billable hours unclear." },
  { vendor: "Greenfield Ventures", invoice_number: "INV-2026-023", amount: 3200.00, due_date: daysFromToday(20), status: "pending", category: "Project Revenue", confidence: 94, summary: "Pitch deck overhaul — Series A fundraising materials." },
  { vendor: "LinkedIn Premium", invoice_number: "LI-PR-26", amount: 39.99, due_date: daysFromToday(-13), status: "paid", category: "Software & SaaS", confidence: 97, summary: "Premium Business — monthly." },
  { vendor: "Rivers Tax Group", invoice_number: "RTG-2026-Q1", amount: 1100.00, due_date: daysFromToday(7), status: "pending", category: "Professional Services", confidence: 91, summary: "Q1 estimated tax preparation and quarterly filing." },
];

const food: SampleItem[] = [
  { vendor: "Restaurant Depot", invoice_number: "RD-44719", amount: 642.18, due_date: daysFromToday(-1), status: "paid", category: "Food & Beverage Inventory", confidence: 97, summary: "Weekly restock: protein, produce, dry goods, paper goods." },
  { vendor: "Sysco", invoice_number: "SYS-260428", amount: 1284.56, due_date: daysFromToday(8), status: "pending", category: "Food & Beverage Inventory", confidence: 95, summary: "Bulk order: cooking oil, spice rubs, takeout containers." },
  { vendor: "City of Austin Permits", invoice_number: "COA-FT-2026", amount: 285.00, due_date: daysFromToday(18), status: "pending", category: "Permits & Licenses", confidence: 93, summary: "Annual mobile food vendor permit renewal." },
  { vendor: "Shell Fleet", invoice_number: "SHL-26-W17", amount: 312.44, due_date: daysFromToday(-6), status: "paid", category: "Fuel & Vehicle Operating", confidence: 96, summary: "Fuel for week of April 21 — generator and truck." },
  { vendor: "AAA Propane Supply", invoice_number: "AAA-8841", amount: 156.00, due_date: daysFromToday(-3), status: "paid", category: "Propane & Utilities", confidence: 94, summary: "Two 40lb propane tank refills." },
  { vendor: "TechCrunch Disrupt (catering)", invoice_number: "INV-2026-014", amount: 3850.00, due_date: daysFromToday(-9), status: "overdue", category: "Catering & Events", confidence: 89, summary: "Catered lunch service for 250 attendees — Day 1 of conference." },
  { vendor: "Rivera Wedding", invoice_number: "INV-2026-015", amount: 2400.00, due_date: daysFromToday(12), status: "pending", category: "Catering & Events", confidence: 92, summary: "Late-night taco bar for 120 guests — June 6 booking, 50% deposit received." },
  { vendor: "South by Southwest LLC", invoice_number: "INV-2026-013", amount: 5200.00, due_date: daysFromToday(-25), status: "overdue", category: "Festival & Vendor Sales", confidence: 91, summary: "Festival vendor booth — three day food service. Awaiting final payment." },
  { vendor: "Block Inc (Square fees)", invoice_number: "SQ-260430", amount: 184.92, due_date: daysFromToday(-4), status: "paid", category: "Payment Processing Fees", confidence: 98, summary: "Card processing fees for April — 2.6% + $0.10 per swipe." },
  { vendor: "Goodyear Commercial Tire", invoice_number: "GY-77182", amount: 920.00, due_date: daysFromToday(-7), status: "needs_review", category: "Vehicle Maintenance & Repair", confidence: 68, summary: "Truck tires — duplicate charge from credit card statement, needs verification." },
  { vendor: "MailChimp", invoice_number: "MC-26-04", amount: 35.00, due_date: daysFromToday(-12), status: "paid", category: "Marketing & Advertising", confidence: 99, summary: "Email marketing — Standard plan, 2,400 subscribers." },
  { vendor: "Atlas Insurance", invoice_number: "ATL-FT-Q2", amount: 685.00, due_date: daysFromToday(22), status: "pending", category: "Business Insurance", confidence: 90, summary: "General liability + commercial auto — Q2 premium." },
];

const creative: SampleItem[] = [
  { vendor: "Hartley Wedding", invoice_number: "INV-2026-031", amount: 4200.00, due_date: daysFromToday(15), status: "pending", category: "Wedding & Event Photography", confidence: 94, summary: "Full-day wedding photography package — June 21 booking, balance after deposit." },
  { vendor: "Mendoza Family Portraits", invoice_number: "INV-2026-029", amount: 685.00, due_date: daysFromToday(-3), status: "paid", category: "Portrait & Family Sessions", confidence: 96, summary: "Spring family session at Franklin Park — 30 edited images delivered." },
  { vendor: "Boutique Hotel Sandstone", invoice_number: "INV-2026-027", amount: 2800.00, due_date: daysFromToday(-12), status: "overdue", category: "Commercial & Licensing", confidence: 88, summary: "Property and lifestyle shoot — full library license, 60 final images." },
  { vendor: "B&H Photo", invoice_number: "BH-9924418", amount: 348.50, due_date: daysFromToday(-6), status: "paid", category: "Equipment", confidence: 98, summary: "Replacement 50mm prime lens after drop on last shoot." },
  { vendor: "SmugMug", invoice_number: "SM-PRO-26", amount: 360.00, due_date: daysFromToday(-30), status: "paid", category: "Cloud Storage & Backup", confidence: 99, summary: "Annual portfolio + client gallery hosting." },
  { vendor: "Pictage Print Lab", invoice_number: "PCT-22184", amount: 124.80, due_date: daysFromToday(-2), status: "paid", category: "Albums & Print Lab", confidence: 95, summary: "Album proofs and 8x10 prints for Mendoza session delivery." },
  { vendor: "Patel Engagement Shoot", invoice_number: "INV-2026-030", amount: 850.00, due_date: daysFromToday(4), status: "pending", category: "Wedding & Event Photography", confidence: 92, summary: "Two-hour engagement session at Lincoln Park lakefront, May 10." },
  { vendor: "Adobe Creative Cloud", invoice_number: "ADBE-260418", amount: 59.99, due_date: daysFromToday(-16), status: "paid", category: "Software & SaaS", confidence: 99, summary: "Photography plan — Lightroom + Photoshop." },
  { vendor: "PhotoShelter", invoice_number: "PSL-MAY26", amount: 49.99, due_date: daysFromToday(1), status: "pending", category: "Cloud Storage & Backup", confidence: 97, summary: "Pro client gallery and archive hosting — monthly." },
  { vendor: "Lumi Studio Rental", invoice_number: "LUM-44721", amount: 220.00, due_date: daysFromToday(-1), status: "paid", category: "Studio Rental & Location Fees", confidence: 93, summary: "Half-day studio rental for headshot session — April 30." },
  { vendor: "Westbrook Branding Co", invoice_number: "INV-2026-028", amount: 1450.00, due_date: daysFromToday(-8), status: "needs_review", category: "Commercial & Licensing", confidence: 75, summary: "Headshot package for 12 staff. Client said check is in mail — confirm receipt." },
  { vendor: "Backblaze B2", invoice_number: "BB-260415", amount: 28.40, due_date: daysFromToday(-15), status: "paid", category: "Cloud Storage & Backup", confidence: 98, summary: "Cloud backup for raw shoot archives — 6TB stored." },
];

const service: SampleItem[] = [
  { vendor: "Stihl Power Equipment", invoice_number: "STL-44912", amount: 487.00, due_date: daysFromToday(-4), status: "paid", category: "Equipment", confidence: 96, summary: "Replacement blade set + chainsaw bar oil for spring season." },
  { vendor: "SiteOne Landscape Supply", invoice_number: "S1L-26-W17", amount: 1248.50, due_date: daysFromToday(-2), status: "paid", category: "Materials & Plants", confidence: 97, summary: "Bulk mulch, fertilizer pellets, and grass seed delivery." },
  { vendor: "Greenwood HOA", invoice_number: "INV-2026-041", amount: 3200.00, due_date: daysFromToday(-8), status: "overdue", category: "Recurring Maintenance", confidence: 92, summary: "Monthly common-area landscaping contract — April service complete." },
  { vendor: "Henderson Residence", invoice_number: "INV-2026-043", amount: 580.00, due_date: daysFromToday(5), status: "pending", category: "One-Time Jobs", confidence: 94, summary: "Spring cleanup + mulch refresh — half-day visit, April 26." },
  { vendor: "Westbrook Apartments", invoice_number: "INV-2026-040", amount: 4800.00, due_date: daysFromToday(-18), status: "overdue", category: "Recurring Maintenance", confidence: 85, summary: "Q1 grounds maintenance — 3 follow-ups sent, AP says check is cut." },
  { vendor: "Acme Insurance Group", invoice_number: "ACM-Q2-26", amount: 425.00, due_date: daysFromToday(11), status: "pending", category: "Business Insurance", confidence: 93, summary: "General liability + commercial auto Q2 premium." },
  { vendor: "Pearson Family", invoice_number: "INV-2026-044", amount: 1850.00, due_date: daysFromToday(12), status: "pending", category: "One-Time Jobs", confidence: 91, summary: "Sod installation — 1,800 sq ft front yard, scheduled May 18." },
  { vendor: "Shell Fleet", invoice_number: "SHL-26-W18", amount: 268.40, due_date: daysFromToday(-1), status: "paid", category: "Fuel & Vehicle Operating", confidence: 98, summary: "Truck and equipment fuel — week of April 28." },
  { vendor: "Jobber", invoice_number: "JBR-MAY26", amount: 99.00, due_date: daysFromToday(2), status: "pending", category: "Software & SaaS", confidence: 99, summary: "Scheduling + invoicing software — Core plan monthly." },
  { vendor: "City of Centennial", invoice_number: "COC-LIC-26", amount: 175.00, due_date: daysFromToday(28), status: "pending", category: "Licenses & Permits", confidence: 95, summary: "Annual landscaping contractor license renewal." },
  { vendor: "Sunbelt Rentals", invoice_number: "SBR-77291", amount: 320.00, due_date: daysFromToday(-6), status: "paid", category: "Equipment", confidence: 94, summary: "Stump grinder rental — 2-day Henderson job." },
  { vendor: "USPS Bulk Mail", invoice_number: "USPS-26-04", amount: 42.80, due_date: daysFromToday(-9), status: "paid", category: "Marketing & Advertising", confidence: 96, summary: "Spring promo postcards mailed to 200 nearby homes." },
];

const ecommerce: SampleItem[] = [
  { vendor: "Amazon FBA Storage", invoice_number: "AMZ-260415", amount: 348.92, due_date: daysFromToday(-5), status: "paid", category: "Marketplace & Platform Fees", confidence: 97, summary: "FBA monthly storage for 280 units across 3 SKUs." },
  { vendor: "Etsy Seller Fees", invoice_number: "ETSY-APR-26", amount: 412.80, due_date: daysFromToday(-3), status: "paid", category: "Marketplace & Platform Fees", confidence: 95, summary: "Listing, transaction, and offsite ads fees — April." },
  { vendor: "Uline", invoice_number: "ULN-9924418", amount: 286.40, due_date: daysFromToday(-7), status: "paid", category: "Packaging Materials", confidence: 98, summary: "Branded mailers, tissue paper, and shipping labels restock." },
  { vendor: "Westbrook Boutique (wholesale)", invoice_number: "INV-2026-051", amount: 2640.00, due_date: daysFromToday(9), status: "pending", category: "Wholesale Orders", confidence: 88, summary: "Wholesale order: 60 units to retailer — Net 30 terms." },
  { vendor: "Helium 10", invoice_number: "H10-26-04", amount: 99.00, due_date: daysFromToday(-12), status: "paid", category: "Software & SaaS", confidence: 99, summary: "Platinum plan — Amazon seller analytics + keyword research." },
  { vendor: "Sprout Wholesale", invoice_number: "INV-2026-049", amount: 1820.00, due_date: daysFromToday(-15), status: "overdue", category: "Wholesale Orders", confidence: 84, summary: "30-unit wholesale — 15 days late, AR says next pay cycle." },
  { vendor: "Canva Pro", invoice_number: "CV-PRO-26", amount: 14.99, due_date: daysFromToday(-22), status: "paid", category: "Software & SaaS", confidence: 99, summary: "Pro plan monthly — product photo edits and listing graphics." },
  { vendor: "USPS Click-N-Ship", invoice_number: "USPS-260430", amount: 412.18, due_date: daysFromToday(-2), status: "paid", category: "Shipping & Postage", confidence: 99, summary: "April postage — 89 customer shipments." },
  { vendor: "Printful", invoice_number: "PFL-77284", amount: 248.50, due_date: daysFromToday(-4), status: "paid", category: "Cost of Goods Sold (COGS)", confidence: 96, summary: "Print-on-demand fulfillment costs — 32 orders." },
  { vendor: "Meta Ads", invoice_number: "META-260430", amount: 185.00, due_date: daysFromToday(-1), status: "paid", category: "Marketing & Advertising", confidence: 97, summary: "April spend — retargeting + lookalike campaigns." },
  { vendor: "Lumi Photo Studio", invoice_number: "PSR-44829", amount: 240.00, due_date: daysFromToday(-10), status: "paid", category: "Photography & Branding", confidence: 92, summary: "Half-day product photography shoot for spring lineup." },
  { vendor: "ShipStation", invoice_number: "SS-MAY26", amount: 35.00, due_date: daysFromToday(4), status: "pending", category: "Software & SaaS", confidence: 99, summary: "Bronze plan monthly — multi-channel shipping management." },
];

const bookkeeper: SampleItem[] = [
  { vendor: "QuickBooks Online Advanced", invoice_number: "QB-ADV-26", amount: 235.00, due_date: daysFromToday(-8), status: "paid", category: "Software & SaaS", confidence: 99, summary: "Advanced plan monthly — supports up to 25 client files." },
  { vendor: "Hartwell Holdings LLC", invoice_number: "INV-2026-061", amount: 1850.00, due_date: daysFromToday(-12), status: "overdue", category: "Monthly Bookkeeping Retainers", confidence: 91, summary: "April monthly close + bank reconciliation — 5 entities, Net 15." },
  { vendor: "Westbrook Realty", invoice_number: "INV-2026-063", amount: 750.00, due_date: daysFromToday(6), status: "pending", category: "Monthly Bookkeeping Retainers", confidence: 94, summary: "Monthly bookkeeping retainer — Net 30 terms." },
  { vendor: "Riverside Cafe", invoice_number: "INV-2026-058", amount: 2400.00, due_date: daysFromToday(-22), status: "overdue", category: "Tax Preparation", confidence: 80, summary: "Q1 close + sales tax filings — owner unresponsive 3 weeks, escalate." },
  { vendor: "CPE Solutions Online", invoice_number: "CPE-26-Q2", amount: 285.00, due_date: daysFromToday(3), status: "pending", category: "Continuing Education", confidence: 95, summary: "Continuing education — Q2 CPA license credits." },
  { vendor: "AICPA Membership", invoice_number: "AICPA-2026", amount: 510.00, due_date: daysFromToday(45), status: "pending", category: "Continuing Education", confidence: 97, summary: "Annual AICPA member dues + ethics module." },
  { vendor: "Karbon", invoice_number: "KBN-MAY26", amount: 79.00, due_date: daysFromToday(2), status: "pending", category: "Software & SaaS", confidence: 99, summary: "Practice management software — Team plan, per-user monthly." },
  { vendor: "Acuity Insurance", invoice_number: "ACU-26-Q2", amount: 320.00, due_date: daysFromToday(15), status: "pending", category: "Business Insurance", confidence: 93, summary: "Professional liability + E&O Q2 premium." },
  { vendor: "Anderson Contracting", invoice_number: "INV-2026-064", amount: 1200.00, due_date: daysFromToday(11), status: "pending", category: "Monthly Bookkeeping Retainers", confidence: 92, summary: "Monthly bookkeeping + payroll processing — 8 employees." },
  { vendor: "Dext", invoice_number: "DXT-26-04", amount: 38.00, due_date: daysFromToday(-18), status: "paid", category: "Software & SaaS", confidence: 98, summary: "Receipt OCR + document capture — per-user monthly." },
  { vendor: "Iron Mountain", invoice_number: "IM-26-Q1", amount: 144.00, due_date: daysFromToday(-1), status: "paid", category: "Professional Services", confidence: 94, summary: "Quarterly secure document storage for client files." },
];

const nonprofit: SampleItem[] = [
  { vendor: "Bloomerang", invoice_number: "BLM-MAY26", amount: 119.00, due_date: daysFromToday(2), status: "pending", category: "Software & SaaS", confidence: 99, summary: "Donor management software — Standard plan monthly." },
  { vendor: "Hartwell Hall (gala venue)", invoice_number: "VEN-44721", amount: 1500.00, due_date: daysFromToday(-3), status: "paid", category: "Office Rent & Utilities", confidence: 95, summary: "Venue deposit — May 24 spring fundraising gala." },
  { vendor: "Spring Appeal Print Run", invoice_number: "PRT-44918", amount: 842.50, due_date: daysFromToday(-9), status: "paid", category: "Marketing & Advertising", confidence: 96, summary: "Direct mail appeal: 2,400 letters printed, addressed, bulk-mailed." },
  { vendor: "Henderson Family Foundation", invoice_number: "INV-2026-070", amount: 25000.00, due_date: daysFromToday(-14), status: "overdue", category: "Grants", confidence: 88, summary: "Q1 grant disbursement per agreement — 14 days late, next board meeting." },
  { vendor: "Westbrook Community Trust", invoice_number: "INV-2026-073", amount: 12000.00, due_date: daysFromToday(18), status: "pending", category: "Grants", confidence: 92, summary: "Approved grant — youth literacy program, scheduled May 22." },
  { vendor: "Verified Volunteers", invoice_number: "VV-260415", amount: 285.00, due_date: daysFromToday(-7), status: "paid", category: "Direct Mission Spending", confidence: 94, summary: "Background checks for 9 new volunteers — spring intake batch." },
  { vendor: "Sarah Chen (grant writer)", invoice_number: "INV-2026-068", amount: 2200.00, due_date: daysFromToday(-5), status: "paid", category: "Professional Services", confidence: 91, summary: "Contracted grant writer — Henderson Foundation Q3 proposal." },
  { vendor: "Mailchimp (nonprofit tier)", invoice_number: "MC-NP-26", amount: 22.50, due_date: daysFromToday(-12), status: "paid", category: "Software & SaaS", confidence: 99, summary: "Email marketing — 15% nonprofit discount applied." },
  { vendor: "Anonymous Donor (gala pledge)", invoice_number: "INV-2026-067", amount: 5000.00, due_date: daysFromToday(-2), status: "paid", category: "Individual Donations", confidence: 90, summary: "Pledged spring gala contribution — received April 28." },
  { vendor: "Adobe Acrobat Pro", invoice_number: "ADBE-260420", amount: 19.99, due_date: daysFromToday(-10), status: "paid", category: "Software & SaaS", confidence: 99, summary: "Annual report PDF assembly — monthly subscription." },
  { vendor: "Eventbrite", invoice_number: "EB-26-Q1", amount: 184.00, due_date: daysFromToday(-1), status: "paid", category: "Payment Processing Fees", confidence: 95, summary: "Ticketing fees for Q1 community events — 240 attendees." },
  { vendor: "Anchor Insurance", invoice_number: "ANC-NP-Q2", amount: 580.00, due_date: daysFromToday(22), status: "pending", category: "Business Insurance", confidence: 93, summary: "Directors & Officers + general liability Q2 premium." },
];

const realestate: SampleItem[] = [
  { vendor: "Local MLS Board", invoice_number: "MLS-26-Q2", amount: 285.00, due_date: daysFromToday(7), status: "pending", category: "Property Management", confidence: 95, summary: "Q2 MLS access fees + lockbox key renewal." },
  { vendor: "Sherwin-Williams Pro", invoice_number: "SW-77428", amount: 412.85, due_date: daysFromToday(-4), status: "paid", category: "Capital Improvements", confidence: 97, summary: "Interior paint + supplies for 1247 Maple flip prep." },
  { vendor: "Mitchell — 1247 Maple Unit B", invoice_number: "INV-2026-081", amount: 1800.00, due_date: daysFromToday(-10), status: "overdue", category: "Rental Income", confidence: 89, summary: "April rent — 10 days late, tenant says payday Friday." },
  { vendor: "Henderson — Unit 4A", invoice_number: "INV-2026-085", amount: 2400.00, due_date: daysFromToday(1), status: "pending", category: "Rental Income", confidence: 94, summary: "May rent due May 1 — automatic ACH on file." },
  { vendor: "Staging Solutions", invoice_number: "STG-44721", amount: 1850.00, due_date: daysFromToday(-2), status: "paid", category: "Property Management", confidence: 92, summary: "30-day staging package for 4892 Birch listing — pickup May 28." },
  { vendor: "First American Title", invoice_number: "FAT-26-0428", amount: 1200.00, due_date: daysFromToday(-6), status: "paid", category: "Professional Services", confidence: 91, summary: "Title search + insurance — 1247 Maple acquisition." },
  { vendor: "Wilson Tenants", invoice_number: "INV-2026-079", amount: 1650.00, due_date: daysFromToday(-22), status: "overdue", category: "Rental Income", confidence: 78, summary: "March rent + late fee outstanding — eviction filing prepared." },
  { vendor: "Stessa", invoice_number: "STS-MAY26", amount: 15.00, due_date: daysFromToday(3), status: "pending", category: "Software & SaaS", confidence: 99, summary: "Pro plan monthly — rental portfolio accounting + reporting." },
  { vendor: "Pinpoint Inspections", invoice_number: "PPI-26-04", amount: 425.00, due_date: daysFromToday(-8), status: "paid", category: "Professional Services", confidence: 95, summary: "Pre-purchase inspection — 4892 Birch investment property." },
  { vendor: "Westbrook Photography", invoice_number: "WBP-77293", amount: 350.00, due_date: daysFromToday(-1), status: "paid", category: "Marketing & Advertising", confidence: 94, summary: "Listing photography + drone shots — 4892 Birch." },
  { vendor: "Allstate Landlord Policy", invoice_number: "ALL-26-Q2", amount: 685.00, due_date: daysFromToday(14), status: "pending", category: "Property Insurance", confidence: 93, summary: "Q2 landlord insurance across 3 rental properties." },
  { vendor: "Home Depot Pro", invoice_number: "HD-9842118", amount: 728.40, due_date: daysFromToday(-12), status: "paid", category: "Repairs & Maintenance", confidence: 96, summary: "Materials for 1247 Maple kitchen refresh — backsplash, fixtures, hardware." },
];

const fitness: SampleItem[] = [
  { vendor: "Rogue Fitness", invoice_number: "RGE-44918", amount: 1240.00, due_date: daysFromToday(-5), status: "paid", category: "Equipment", confidence: 96, summary: "Replacement kettlebell set + barbells for class space." },
  { vendor: "Mindbody", invoice_number: "MBD-MAY26", amount: 159.00, due_date: daysFromToday(2), status: "pending", category: "Software & SaaS", confidence: 99, summary: "Essential plan monthly — class booking + client management." },
  { vendor: "Henderson Family", invoice_number: "INV-2026-091", amount: 720.00, due_date: daysFromToday(-3), status: "paid", category: "1-on-1 Training", confidence: 95, summary: "12-session personal training package — paid in full April 28." },
  { vendor: "Acme Corp (corporate wellness)", invoice_number: "INV-2026-093", amount: 2800.00, due_date: daysFromToday(8), status: "pending", category: "Group Programs", confidence: 92, summary: "April on-site yoga sessions — 8 weekly classes, Net 30." },
  { vendor: "Westbrook Insurance Pros", invoice_number: "WIP-26-Q2", amount: 485.00, due_date: daysFromToday(12), status: "pending", category: "Business Insurance", confidence: 94, summary: "Professional liability + general liability Q2 — trainer/studio coverage." },
  { vendor: "Boutique Studio Lease", invoice_number: "LSE-26-MAY", amount: 1850.00, due_date: daysFromToday(-1), status: "paid", category: "Gym Rent & Studio Space", confidence: 98, summary: "May studio rent — 1,200 sqft commercial unit." },
  { vendor: "Bloom Wellness Co", invoice_number: "INV-2026-089", amount: 1450.00, due_date: daysFromToday(-18), status: "overdue", category: "Group Programs", confidence: 82, summary: "Q1 staff wellness program — 18 days late, HR routing for approval." },
  { vendor: "Soundtrack Your Brand", invoice_number: "SYB-MAY26", amount: 26.99, due_date: daysFromToday(-9), status: "paid", category: "Music & Content Subscriptions", confidence: 99, summary: "Licensed music streaming — class music, monthly." },
  { vendor: "Cintas Towel Service", invoice_number: "CIN-77284", amount: 142.00, due_date: daysFromToday(4), status: "pending", category: "Professional Services", confidence: 95, summary: "Weekly towel + laundry service — May invoice." },
  { vendor: "Garcia Group Training", invoice_number: "INV-2026-088", amount: 480.00, due_date: daysFromToday(15), status: "pending", category: "Group Programs", confidence: 91, summary: "Bridal-party group training package — 4 sessions, May 15-29." },
  { vendor: "NASM", invoice_number: "NASM-26-CE", amount: 175.00, due_date: daysFromToday(-12), status: "paid", category: "Certifications & Continuing Education", confidence: 96, summary: "Continuing education — corrective exercise specialist module." },
  { vendor: "RockTape Supply", invoice_number: "RT-44829", amount: 84.50, due_date: daysFromToday(-7), status: "paid", category: "Equipment", confidence: 97, summary: "Kinesiology tape and mobility band restock." },
];

const generic: SampleItem[] = [
  { vendor: "Office Depot", invoice_number: "OD-9942", amount: 84.50, due_date: daysFromToday(-5), status: "paid", category: "Office Supplies", confidence: 96, summary: "Office supplies: paper, ink cartridges, pens." },
  { vendor: "Comcast Business", invoice_number: "CB-MAY26", amount: 189.99, due_date: daysFromToday(3), status: "pending", category: "Telecom & Internet", confidence: 98, summary: "Business internet — 500/50 plan, monthly." },
  { vendor: "Acme Client LLC", invoice_number: "INV-2026-007", amount: 2400.00, due_date: daysFromToday(-10), status: "overdue", category: "Service Revenue", confidence: 91, summary: "Services rendered — invoice sent, payment 10 days past due." },
  { vendor: "Gusto Payroll", invoice_number: "GST-260501", amount: 142.00, due_date: daysFromToday(-3), status: "paid", category: "Software & SaaS", confidence: 99, summary: "Monthly payroll software — Core plan, 3 employees." },
  { vendor: "QuickBooks Online", invoice_number: "QB-26-04", amount: 65.00, due_date: daysFromToday(-19), status: "paid", category: "Software & SaaS", confidence: 99, summary: "Essentials subscription — monthly accounting software." },
  { vendor: "Bright Horizons LLC", invoice_number: "INV-2026-008", amount: 1850.00, due_date: daysFromToday(7), status: "pending", category: "Service Revenue", confidence: 89, summary: "April services per agreement — net 15 terms." },
  { vendor: "State Farm Business", invoice_number: "SF-26-Q2", amount: 425.00, due_date: daysFromToday(14), status: "pending", category: "Business Insurance", confidence: 94, summary: "Quarterly business insurance premium." },
  { vendor: "Costco Business", invoice_number: "CST-44820", amount: 318.42, due_date: daysFromToday(-2), status: "paid", category: "Office Supplies", confidence: 95, summary: "Bulk supply run — break room and shipping materials." },
  { vendor: "Zoom", invoice_number: "ZM-PRO-26", amount: 14.99, due_date: daysFromToday(-22), status: "paid", category: "Software & SaaS", confidence: 99, summary: "Pro plan monthly subscription." },
  { vendor: "Hartwell Group", invoice_number: "INV-2026-009", amount: 950.00, due_date: daysFromToday(-6), status: "needs_review", category: "Service Revenue", confidence: 70, summary: "Outstanding balance — partial payment received, follow up on remainder." },
  { vendor: "USPS", invoice_number: "USPS-260428", amount: 56.20, due_date: daysFromToday(-4), status: "paid", category: "Office Supplies", confidence: 97, summary: "Postage and shipping for April outgoing mail." },
];

const INDUSTRY_DATA: Record<string, SampleItem[]> = {
  marketplace,
  freelance,
  service,
  food,
  ecommerce,
  creative,
  bookkeeper,
  nonprofit,
  realestate,
  fitness,
  other: generic,
};

export function getSampleData(industry: string): SampleItem[] {
  return INDUSTRY_DATA[industry] || generic;
}
