import type { Metadata } from "next";
import { Lora, Nunito_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { SessionProvider } from "./providers";

// Dreamward brand type (Sage & Rose redesign): Lora is the warm
// editorial display serif for headlines — calligraphic warmth with
// conventional letterforms (Fraunces' swooping f read as "weird" at
// display sizes). Nunito Sans is the friendly humanist body sans.
// Exposed as CSS variables that globals.css wires to --font-serif /
// --font-sans (Tailwind's font-serif / font-sans).
const display = Lora({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  // Default app-wide metadata. Pages with their own metadata
  // export (e.g., app/page.tsx for the landing) override these.
  metadataBase: new URL("https://godreamward.com"),
  title: {
    default: "Dreamward — Gross margin tracking for small business",
    template: "%s · Dreamward",
  },
  description:
    "Per-SKU COGS, per-channel margin, Schedule-C-ready P&L. Built for makers + small businesses that outgrew spreadsheets.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${nunitoSans.variable}`}>
      <body>
        <SessionProvider>{children}</SessionProvider>
        {/* Vercel Analytics — pageviews + conversion measurement.
            First analytics on the site (2026-07-02 review): without it
            we can't see visitors, signups, or which /for + /compare
            pages actually pull traffic. */}
        <Analytics />
      </body>
    </html>
  );
}