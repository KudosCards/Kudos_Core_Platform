import type { MetadataRoute } from "next";
import type { CardDesign } from "@kudos/shared-types";
import { publicApiFetch, CATALOG_REVALIDATE_SECONDS } from "@/lib/api.public";
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
    { url: absoluteUrl("/terms"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/privacy"), changeFrequency: "yearly", priority: 0.2 },
  ];

  // `publicApiFetch` returns null when the catalog API is unreachable. Fall back
  // to the marketing pages rather than throwing: a sitemap must never be the
  // reason a build fails. Same tolerance as generateStaticParams on /cards/[id].
  const cards = await publicApiFetch<CardDesign[]>("/card-designs", {
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });

  return [
    ...marketingPages,
    ...(cards ?? []).map((card) => ({
      url: absoluteUrl(`/cards/${card.id}`),
      lastModified: card.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
