import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { CardDesign } from "@kudos/shared-types";
import { publicApiFetch } from "@/lib/api.public";
import { CardsHeader } from "../../cards-header";
import { GuestSendClient } from "./guest-send-client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const card = await publicApiFetch<CardDesign>(`/card-designs/${id}`);
  return { title: card ? `Send ${card.name} — Kudos Cards` : "Send a card — Kudos Cards" };
}

/**
 * The guest one-off send flow (public — no account). Shows the chosen card
 * alongside the recipient/address/email form; submitting redirects to Stripe.
 * See docs/adr/0025-guest-one-off-purchases-and-account-tiers.md.
 */
export default async function GuestSendPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await publicApiFetch<CardDesign>(`/card-designs/${id}`);
  if (!card) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <CardsHeader />
      <main className="mx-auto max-w-5xl px-6 py-12">
        <Link href={`/cards/${card.id}`} className="text-sm text-slate-500 hover:text-slate-900">
          ← Back to the card
        </Link>
        <div className="mt-6 grid items-start gap-10 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="relative mx-auto aspect-[3/4] w-full max-w-xs overflow-hidden rounded-2xl bg-slate-50 shadow-2xl ring-1 ring-slate-100">
              <Image
                src={card.thumbnailUrl}
                alt={card.name}
                fill
                unoptimized
                className="object-cover"
              />
            </div>
            <div className="text-center">
              <p className="font-semibold">{card.name}</p>
              <p className="text-sm text-slate-500">
                We print it and post a real card — £2.50, all in.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                Add to your basket
              </h1>
              <p className="mt-1 text-slate-600">
                Just the details, no sign-up — add this card for someone, then keep shopping or pay.
                Want to save birthdays and never miss one?{" "}
                <Link href={`/register?card=${card.id}`} className="font-medium text-rose-600 hover:underline">
                  Create a free account
                </Link>{" "}
                instead.
              </p>
            </div>
            <GuestSendClient cardId={card.id} cardName={card.name} thumbnailUrl={card.thumbnailUrl} />
          </div>
        </div>
      </main>
    </div>
  );
}
