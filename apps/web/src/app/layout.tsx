import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import { Analytics } from "@/components/analytics";
import { CookieBanner } from "@/components/cookie-banner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Every relative `alternates.canonical` and OG URL below resolves against this,
  // so it must be set before canonicals are worth anything. See lib/site.ts and
  // docs/seo-plan.md (Phase 1).
  metadataBase: new URL(SITE_URL),
  title: {
    // Used by any page that doesn't set its own title (mostly the signed-in app).
    default: "Kudos Cards — real cards, printed and posted for you",
    // Pages set the bare page name ("Card library") and get the brand appended
    // once, here, instead of every page repeating the suffix by hand.
    template: "%s — Kudos Cards",
  },
  description:
    "Real, personalised cards, printed and posted for you — so you never miss a birthday, thank-you or milestone.",
  // Favicons come from the file-based convention (app/favicon.ico, app/icon.png,
  // app/apple-icon.png) — the Kudos Cards megaphone mark. A manual `icons` field
  // here would override those, so it's intentionally omitted.
  openGraph: {
    type: "website",
    siteName: "Kudos Cards",
    locale: "en_GB",
    title: "Kudos Cards — real cards, printed and posted for you",
    description:
      "Real, personalised cards, printed and posted for you — so you never miss a birthday, thank-you or milestone.",
  },
  twitter: { card: "summary_large_image" },
  // The share image itself is app/opengraph-image.tsx, picked up by file
  // convention and inherited by every route that doesn't override it.
};

// Explicit mobile viewport. `initialScale: 1` fits to device width, and we
// deliberately leave pinch-zoom enabled (no maximumScale/userScalable cap) so
// the app stays accessible to low-vision users.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Analytics />
        <CookieBanner />
      </body>
    </html>
  );
}
