import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { CardDesign } from "@kudos/shared-types";
import { CARD_PRICE_MINOR, POSTAGE_MINOR } from "@kudos/shared-types";
import { publicApiFetch, CATALOG_REVALIDATE_SECONDS } from "@/lib/api.public";
import { CARD_BLUR_DATA_URL, isOptimizableThumbnail } from "@/lib/card-image";
import { cardCategorySegment, cardPath, cardSendPath, isPublishableCard } from "@/lib/card-urls";
import { NO_INDEX } from "@/lib/site";
import { CardsHeader } from "../../../cards-header";
import { GuestSendClient } from "./guest-send-client";

// ISR: the server render is pure catalog data (the guest form is client-side),
// so cache it like the other /cards pages. Keep in sync with
// CATALOG_REVALIDATE_SECONDS. See docs/adr/0044-public-catalog-isr.md.
export const revalidate = 3600;

// Prerender the send-entry shell for every catalog card (build-safe: null → no
// params if the API is unreachable at build; dynamicParams renders the rest).
export async function generateStaticParams(): Promise<{ category: string; slug: string }[]> {
  const templates = await publicApiFetch<CardDesign[]>("/card-designs", {
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });
  return (templates ?? []).filter(isPublishableCard).map((card) => ({
    category: cardCategorySegment(card),
    slug: card.slug,
  }));
}

async function fetchCard(slug: string): Promise<CardDesign | null> {
  return publicApiFetch<CardDesign>(`/card-designs/${slug}`, {
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const card = await fetchCard(slug);
  // A checkout step, not a landing page — the card's own page is the indexable
  // version of this content.
  return {
    title: card ? `Send ${card.name}` : "Send a card",
    ...NO_INDEX,
  };
}

/**
 * The guest one-off send flow (public — no account). Shows the chosen card
 * alongside the recipient/address/email form; submitting redirects to Stripe.
 * See docs/adr/0025-guest-one-off-purchases-and-account-tiers.md.
 */
export default async function GuestSendPage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}) {
  const { category, slug } = await params;
  const card = await fetchCard(slug);
  if (!card) {
    notFound();
  }

  // Reached under the wrong category — one card, one URL.
  if (cardCategorySegment(card) !== category) {
    permanentRedirect(cardSendPath(card));
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <CardsHeader />
      <main className="mx-auto max-w-5xl px-6 py-12">
        <Link href={cardPath(card)} className="text-sm text-slate-500 hover:text-slate-900">
          ← Back to the card
        </Link>
        <div className="mt-6 grid items-start gap-10 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="relative mx-auto aspect-[105/148] w-full max-w-xs overflow-hidden rounded-2xl bg-slate-50 shadow-2xl ring-1 ring-slate-100">
              <Image
                src={card.thumbnailUrl}
                alt={card.name}
                fill
                // LCP of the guest-send page — load eagerly, not lazily.
                priority
                sizes="(min-width: 768px) 320px, 100vw"
                placeholder="blur"
                blurDataURL={CARD_BLUR_DATA_URL}
                unoptimized={!isOptimizableThumbnail(card.thumbnailUrl)}
                className="object-cover"
              />
            </div>
            <div className="text-center">
              <p className="font-semibold">{card.name}</p>
              {/* Card price and stamp are separate charges at the basket, so
                  quote them separately here. Derived from the pricing constants
                  so the copy can't drift from what's charged. */}
              <p className="text-sm text-slate-500">
                We print it and post a real card — £{(CARD_PRICE_MINOR / 100).toFixed(2)} a card,
                plus a £{(POSTAGE_MINOR.second_class / 100).toFixed(2)} second-class stamp.
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
                <Link
                  href={`/register?card=${card.id}`}
                  className="font-medium text-rose-600 hover:underline"
                >
                  Create a free account
                </Link>{" "}
                instead.
              </p>
            </div>
            <GuestSendClient
              cardId={card.id}
              cardName={card.name}
              thumbnailUrl={card.thumbnailUrl}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
