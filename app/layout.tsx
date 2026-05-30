import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "./providers";

export const metadata: Metadata = {
  // Default app-wide metadata. Pages with their own metadata
  // export (e.g., app/page.tsx for the landing) override these.
  metadataBase: new URL("https://flowworks.it.com"),
  title: {
    default: "FlowWork — Gross margin tracking for small business",
    template: "%s · FlowWork",
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
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}