import { resolveCardCategory, type CardDesign } from "@kudos/shared-types";

/**
 * The public catalog's URL shape — `/cards/<category>/<slug>`. One definition,
 * so a link, a canonical, a sitemap entry and a breadcrumb can't disagree.
 * See docs/adr/0163-catalog-urls-and-category-pages.md.
 */

/**
 * Where cards land when their upstream category isn't in the published
 * vocabulary — "blank", "uncategorised", or a category ops added before we
 * named it.
 *
 * Every card needs exactly one canonical URL, so these can't simply be left out
 * of the hierarchy: without this they'd be orphaned, or their breadcrumb would
 * point at a category page that 404s. The card pages here are perfectly
 * indexable; only the grab-bag landing page itself is noindex, because "other"
 * is not a thing anyone searches for.
 */
export const OTHER_CATEGORY_SLUG = "other";

/** The category segment for a design — its published category, or `other`. */
export function cardCategorySegment(card: Pick<CardDesign, "category">): string {
  return resolveCardCategory(card.category)?.slug ?? OTHER_CATEGORY_SLUG;
}

/** Canonical path for a card design. */
export function cardPath(card: Pick<CardDesign, "category" | "slug">): string {
  return `/cards/${cardCategorySegment(card)}/${card.slug}`;
}

/** Canonical path for the guest send flow for a card. */
export function cardSendPath(card: Pick<CardDesign, "category" | "slug">): string {
  return `${cardPath(card)}/send`;
}

/**
 * Whether a design can be published yet — i.e. the catalog API gave it a slug.
 *
 * `CardDesign` types `slug` as a required string, but `publicApiFetch` casts the
 * response rather than parsing it, so that type is a promise an *older* API
 * doesn't keep. During a deploy where the web ships ahead of the API (or the API
 * is rolled back), the catalog comes back without slugs and every URL we'd build
 * would be `/cards/<category>/undefined` — which took the whole build down with
 * "a required parameter (slug) was not provided".
 *
 * Filtering here degrades that to "those cards aren't listed yet" and lets the
 * build succeed, the same tolerance `publicApiFetch` already has for the API
 * being unreachable. ISR picks them up once the API catches up.
 */
export function isPublishableCard(card: Pick<CardDesign, "slug">): boolean {
  return typeof card.slug === "string" && card.slug.length > 0;
}

/** Canonical path for a category landing page. */
export function categoryPath(categorySlug: string): string {
  return `/cards/${categorySlug}`;
}
