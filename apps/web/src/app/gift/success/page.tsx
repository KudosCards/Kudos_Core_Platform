import type { Metadata } from "next";
import Link from "next/link";
import { CardsHeader } from "../../cards/cards-header";

export const metadata: Metadata = { title: "Your card is on its way — Kudos Cards" };

/**
 * Stripe success_url for guest one-off purchases (public — a guest has no
 * session). The order is already paid and queued via the webhook; this just
 * confirms and nudges toward an account. Account-claiming lands in a later
 * phase. See docs/adr/0025.
 */
export default async function GiftSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string }>;
}) {
  const { claim } = await searchParams;
  // With a claim token we can attach a login to this exact order; without one
  // (e.g. an old link) fall back to a plain sign-up.
  const claimHref = claim ? `/gift/claim?token=${encodeURIComponent(claim)}` : "/register";

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <CardsHeader />
      <main className="mx-auto flex max-w-lg flex-col items-center gap-6 px-6 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl">
          🎉
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">Your card is on its way!</h1>
        <p className="text-slate-600">
          Thanks — we&apos;re printing your card and posting it out. A receipt is on its way to your
          email.
        </p>
        <div className="mt-2 flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-6">
          <p className="font-semibold">Never miss their birthday again</p>
          <p className="text-sm text-slate-600">
            Create a free account to save this contact, get a reminder next year, and let us send it
            for you automatically.
          </p>
          <Link
            href={claimHref}
            className="mt-1 rounded-full bg-rose-600 px-6 py-3 text-center font-semibold text-white transition-opacity hover:opacity-90"
          >
            Create a free account
          </Link>
        </div>
        <Link href="/cards" className="text-sm text-slate-500 hover:text-slate-900">
          Send another card →
        </Link>
      </main>
    </div>
  );
}
