import type { Metadata } from "next";
import Link from "next/link";
import { CardsHeader } from "../../cards/cards-header";

export const metadata: Metadata = { title: "Checkout cancelled — Kudos Cards" };

/** Stripe cancel_url for guest one-off purchases (public). Nothing was charged. */
export default function GiftCancelledPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <CardsHeader />
      <main className="mx-auto flex max-w-lg flex-col items-center gap-6 px-6 py-20 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">Checkout cancelled</h1>
        <p className="text-slate-600">
          No worries — you haven&apos;t been charged. Your card is still waiting whenever you&apos;re
          ready.
        </p>
        <Link
          href="/cards"
          className="rounded-full bg-rose-600 px-6 py-3 font-semibold text-white transition-opacity hover:opacity-90"
        >
          Back to the card library
        </Link>
      </main>
    </div>
  );
}
