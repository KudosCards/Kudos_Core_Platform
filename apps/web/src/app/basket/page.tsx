import type { Metadata } from "next";
import { PublicHeader } from "@/components/public-header";
import { BasketClient } from "./basket-client";

export const metadata: Metadata = {
  title: "Your basket — Kudos Cards",
};

/**
 * The guest basket page — the cards a one-off visitor has added, and the
 * single pay-for-all checkout. Public (no account). The basket itself lives in
 * the browser (see lib/cart.ts); this page just renders it. See docs/adr/0025.
 */
export default function BasketPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <PublicHeader navLinks={[{ href: "/cards", label: "Card library" }]} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <h1 className="mb-6 text-2xl font-extrabold tracking-tight sm:text-3xl">Your basket</h1>
        <BasketClient />
      </main>
    </div>
  );
}
