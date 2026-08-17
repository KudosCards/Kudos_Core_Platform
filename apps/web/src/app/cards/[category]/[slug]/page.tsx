import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { CardDesign } from "@kudos/shared-types";
import { CARD_PRICE_MINOR, CARD_SIZE_LABEL, getCardCategory } from "@kudos/shared-types";
import { publicApiFetch, CATALOG_REVALIDATE_SECONDS } from "@/lib/api.public";
import { CARD_BLUR_DATA_URL, isOptimizableThumbnail } from "@/lib/card-image";
import {
  cardCategorySegment,
  cardPath,
  cardSendPath,
  isPublishableCard,
  OTHER_CATEGORY_SLUG,
} from "@/lib/card-urls";
import { openGraphFor } from "@/lib/site";
import { breadcrumbSchema, cardProductSchema } from "@/lib/structured-data";
import { JsonLd } from "@/components/json-ld";
import { CardsHeader } from "../../cards-header";
import { PersonaliseButton } from "./personalise-button";

// ISR, as before. See ADR 0044.
export const revalidate = 3600;

/**
 * A card — `/cards/birthday/simple-happy-birthday-fun`.
 *
 * This route also absorbs the old `/cards/<uuid>/send` URLs: they have the same
 * two-segment shape, so Next routes them here and they're redirected on to the
 * card's new send URL. See docs/adr/0163-catalog-urls-and-category-pages.md.
 */

export async function generateStaticParams(): Promise<{ category: string; slug: string }[]> {
  const templates = await publicApiFetch<CardDesign[]>("/card-designs", {
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });
  return (templates ?? []).filter(isPublishableCard).map((card) => ({
    category: cardCategorySegment(card),
    slug: card.slug,
  }));
}

/** Shared by the meta description and the Product JSON-LD, so they can't diverge. */
function cardDescription(card: CardDesign): string {
  return `${card.name} — personalised with every recipient's name, then printed and posted for you from £${(CARD_PRICE_MINOR / 100).toFixed(2)} a card plus postage.`;
}

async function fetchCard(slug: string): Promise<CardDesign | null> {
  return publicApiFetch<CardDesign>(`/card-designs/${slug}`, {
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}): Promise<Metadata> {
  const { category, slug } = await params;
  const card = await fetchCard(slug);
  if (!card || cardCategorySegment(card) !== category) {
    // Either a 404 or a redirect — the page function decides. Nothing to index.
    return { title: "Card" };
  }

  const description = cardDescription(card);
  return {
    title: card.name,
    description,
    alternates: { canonical: cardPath(card) },
    openGraph: openGraphFor({
      type: "article",
      url: cardPath(card),
      title: card.name,
      description,
      images: [{ url: card.thumbnailUrl, alt: card.name }],
    }),
  };
}

export default async function CardPreviewPage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}) {
  const { category, slug } = await params;
  const known = getCardCategory(category);

  // Old `/cards/<uuid>/send`: the first segment is a card identifier, not a
  // category, and the second is the literal "send".
  if (!known && category !== OTHER_CATEGORY_SLUG && slug === "send") {
    const legacy = await fetchCard(category);
    if (legacy) {
      permanentRedirect(cardSendPath(legacy));
    }
    notFound();
  }

  const card = await fetchCard(slug);
  if (!card) {
    notFound();
  }

  // The card is real but sits under a different category — one card, one URL, so
  // send the visitor (and the crawler) to the canonical one rather than serving
  // the same content twice.
  if (cardCategorySegment(card) !== category) {
    permanentRedirect(cardPath(card));
  }

  const categoryName = known?.name ?? "More cards";

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <JsonLd data={cardProductSchema(card, cardDescription(card))} />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Card library", path: "/cards" },
          { name: categoryName, path: `/cards/${category}` },
          { name: card.name, path: cardPath(card) },
        ])}
      />
      <CardsHeader />
      <main className="mx-auto max-w-5xl px-6 py-12">
        <nav className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <Link href="/cards" className="hover:text-slate-900">
            Card library
          </Link>
          <span aria-hidden>/</span>
          <Link href={`/cards/${category}`} className="hover:text-slate-900">
            {categoryName}
          </Link>
        </nav>
        <div className="mt-6 grid items-start gap-10 md:grid-cols-2">
          <div className="relative mx-auto aspect-[105/148] w-full max-w-sm overflow-hidden rounded-2xl bg-slate-50 shadow-2xl ring-1 ring-slate-100">
            <Image
              src={card.thumbnailUrl}
              alt={card.name}
              fill
              // The product-page hero is this route's LCP — load it eagerly
              // instead of lazily so it paints as fast as possible.
              priority
              sizes="(min-width: 768px) 384px, 100vw"
              placeholder="blur"
              blurDataURL={CARD_BLUR_DATA_URL}
              unoptimized={!isOptimizableThumbnail(card.thumbnailUrl)}
              className="object-cover"
            />
          </div>
          <div className="flex flex-col gap-5">
            <Link
              href={`/cards/${category}`}
              className="w-fit rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-100"
            >
              {categoryName}
            </Link>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{card.name}</h1>
            <p className="text-slate-600">
              Make it yours — add your centre&apos;s message and every student&apos;s name is merged
              in automatically. We print it and post a real card to their home.
            </p>
            <ul className="flex flex-col gap-2 text-sm text-slate-600">
              <li className="flex items-center gap-2">
                <span className="text-emerald-500">✓</span> Personalised with each recipient&apos;s
                name
              </li>
              <li className="flex items-center gap-2">
                <span className="text-emerald-500">✓</span> Printed &amp; posted for you — from £
                {(CARD_PRICE_MINOR / 100).toFixed(2)} a card plus postage
              </li>
              <li className="flex items-center gap-2">
                <span className="text-emerald-500">✓</span> Add a scan-to-watch message page —
                video, note &amp; link
              </li>
              <li className="flex items-center gap-2">
                <span className="text-emerald-500">✓</span> Printed {CARD_SIZE_LABEL} — more sizes
                coming soon
              </li>
            </ul>
            <div className="pt-2">
              <PersonaliseButton
                cardId={card.id}
                cardName={card.name}
                sendHref={cardSendPath(card)}
              />
              <p className="mt-2 text-xs text-slate-500">
                Free to start — you only pay when you send a card.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
