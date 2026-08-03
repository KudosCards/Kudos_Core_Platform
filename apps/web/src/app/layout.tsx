import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Kudos Cards",
  description: "Automated, personalised physical recognition that builds retention and loyalty.",
  // Favicons come from the file-based convention (app/favicon.ico, app/icon.png,
  // app/apple-icon.png) — the Kudos Cards megaphone mark. A manual `icons` field
  // here would override those, so it's intentionally omitted.
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
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
