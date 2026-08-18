import type { MetadataRoute } from "next";
import type { CardDesign } from "@kudos/shared-types";
import { publicApiFetch, CATALOG_REVALIDATE_SECONDS } from "@/lib/api.public";
import { CARD_CATEGORIES } from "@kudos/shared-types";
import { AUDIENCES } from "@/lib/audiences";
import { cardCategorySegment, cardPath, categoryPath, isPublishableCard } from "@/lib/card-urls";
import { absoluteUrl } from "@/lib/site";

/**
 * sitemap.xml — the marketing pages plus every public card design.
 *
 * Regenerated on the same hourly window as the catalog pages themselves, so a
 * newly synced design shows up in the sitemap at the same time its page does.
 * See docs/adr/0044-public-catalog-isr.md.
 */
// Must be a literal — Next only statically analyses segment config exports, so
// an imported constant here fails the build. Keep in sync with
// CATALOG_REVALIDATE_SECONDS, as the /cards pages do.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const marketingPages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/cards"), changeFrequency: "daily", priority: 0.9 },
    { url: absoluteUrl("/enterprise"), changeFrequency: "monthly", priority: 0.7 },
    { url: absoluteUrl("/faq"), changeFrequency: "monthly", priority: 0.6 },
    { url: absoluteUrl("/for"), changeFrequency: "monthly", priority: 0.7 },
    // One entry per audience page — a static set, so no API call and nothing to
    // degrade if the catalog is unreachable.
    ...AUDIENCES.map((audience) => ({
      url: absoluteUrl(`/for/${audience.slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    { url: absoluteUrl("/terms"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/privacy"), changeFrequency: "yearly", priority: 0.2 },
  ];

  // `publicApiFetch` returns null when the catalog API is unreachable. Fall back
  // to the marketing pages rather than throwing: a sitemap must never be the
  // reason a build fails. Same tolerance as generateStaticParams on the card routes.
  const cards = await publicApiFetch<CardDesign[]>("/card-designs", {
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });

  // Only cards the API has given a slug — see isPublishableCard().
  const catalog = (cards ?? []).filter(isPublishableCard);

  // Only categories that actually have cards — a sitemap entry for a category
  // page that 404s (the page itself notFound()s when empty) is a crawl error we
  // would be publishing on purpose. `other` is deliberately absent: those cards
  // are listed individually, but the grab-bag page is noindex.
  const stockedCategories = new Set(catalog.map((card) => cardCategorySegment(card)));
  const categoryPages: MetadataRoute.Sitemap = CARD_CATEGORIES.filter((category) =>
    stockedCategories.has(category.slug),
  ).map((category) => ({
    url: absoluteUrl(categoryPath(category.slug)),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  return [
    ...marketingPages,
    ...categoryPages,
    ...catalog.map((card) => ({
      url: absoluteUrl(cardPath(card)),
      lastModified: card.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
