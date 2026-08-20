import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import type { CardDesign } from "@kudos/shared-types";
import { CARD_CATEGORIES, CARD_SIZE_NOTICE, getCardCategory } from "@kudos/shared-types";
import { fetchCatalogCards, fetchCatalogCard } from "@/lib/catalog";
import {
  cardCategorySegment,
  cardPath,
  isPublishableCard,
  OTHER_CATEGORY_SLUG,
} from "@/lib/card-urls";
import { guideForCategory } from "@/lib/guides";
import { NO_INDEX, openGraphFor } from "@/lib/site";
import { breadcrumbSchema } from "@/lib/structured-data";
import { JsonLd } from "@/components/json-ld";
import { CardsHeader } from "../cards-header";
import { CardsGalleryClient } from "../cards-gallery-client";

// Same ISR window as the rest of the catalog. See ADR 0044.
export const revalidate = 3600;

/**
 * A category landing page — `/cards/birthday`.
 *
 * This route also absorbs the **old** card URLs. `/cards/<uuid>` was the card
 * page before ADR 0163, and it has the same shape as a category URL, so Next
 * routes both here. Anything that isn't a published category is therefore tried
 * as a card identifier and permanently redirected to its new home, which keeps
 * indexed links, saved links and printed QR codes working.
 */

/** Only published categories are prerendered; `other` is generated on demand. */
export async function generateStaticParams(): Promise<{ category: string }[]> {
  return CARD_CATEGORIES.map((category) => ({ category: category.slug }));
}

async function fetchCatalog(): Promise<CardDesign[]> {
  return fetchCatalogCards();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const known = getCardCategory(category);

  if (known) {
    return {
      title: known.title,
      description: known.description,
      alternates: { canonical: `/cards/${known.slug}` },
      openGraph: openGraphFor({
        url: `/cards/${known.slug}`,
        title: known.title,
        description: known.description,
      }),
    };
  }

  if (category === OTHER_CATEGORY_SLUG) {
    // A grab-bag, not a search term — reachable and crawlable so the cards under
    // it aren't orphaned, but never itself a landing page.
    return { title: "More cards", ...NO_INDEX };
  }

  // An old card URL about to redirect; metadata is never rendered.
  return { title: "Card library", ...NO_INDEX };
}

export default async function CardCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const known = getCardCategory(category);

  if (!known && category !== OTHER_CATEGORY_SLUG) {
    // Not a category — try it as a card id or slug. `/card-designs/:idOrSlug`
    // accepts both (ADR 0163), so this covers the pre-0163 `/cards/<uuid>` URLs
    // and a hand-typed `/cards/<slug>` alike.
    const card = await fetchCatalogCard(category);
    if (card) {
      permanentRedirect(cardPath(card));
    }
    notFound();
  }

  const catalog = await fetchCatalog();
  const cards = catalog
    .filter(isPublishableCard)
    .filter((card) => cardCategorySegment(card) === category);

  // A published category with nothing in it is a dead end for a visitor and a
  // thin page for a crawler.
  if (cards.length === 0) {
    notFound();
  }

  const heading = known ? known.name : "More cards";
  // Not every category has a guide; the ones that do get a link, because
  // "what do I write in it" is the question between browsing and buying.
  const guide = guideForCategory(category);
  const intro = known
    ? known.description
    : "Designs that don't sit under one of our main occasions — still printed and posted for you.";

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Card library", path: "/cards" },
          { name: heading, path: `/cards/${category}` },
        ])}
      />
      <CardsHeader />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <nav className="text-sm text-slate-500">
          <Link href="/cards" className="hover:text-slate-900">
            ← All cards
          </Link>
        </nav>
        <div className="mt-4 flex max-w-2xl flex-col gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{heading} cards</h1>
          <p className="text-slate-600">{intro}</p>
          <p className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {CARD_SIZE_NOTICE}
          </p>
        </div>
        {guide && (
          <p className="mt-6 text-sm text-slate-600">
            Not sure what to write?{" "}
            <Link
              href={`/guides/${guide.slug}`}
              className="font-medium text-rose-600 hover:underline"
            >
              {guide.heading}
            </Link>
          </p>
        )}

        <div className="mt-8">
          <CardsGalleryClient templates={cards} />
        </div>

        {/* Sideways links, so every category page is one click from the others
            and a crawler can reach the whole set from any of them. */}
        <nav className="mt-14 border-t border-slate-100 pt-8">
          <h2 className="text-sm font-semibold text-slate-900">Browse other occasions</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {CARD_CATEGORIES.filter((other) => other.slug !== category).map((other) => (
              <li key={other.slug}>
                <Link
                  href={`/cards/${other.slug}`}
                  className="inline-block rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-600 hover:border-slate-300 hover:text-slate-900"
                >
                  {other.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </div>
  );
}
