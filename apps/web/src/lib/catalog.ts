import type { CardDesign } from "@kudos/shared-types";
import { publicApiFetch, CATALOG_REVALIDATE_SECONDS } from "./api.public";

/**
 * Reading the public card catalog — one definition, so every marketing surface
 * caches it the same way and they can't drift out of step with each other.
 *
 * Before this, each of the six catalog reads (`/cards`, the category page, the
 * card page, the send page, and both sets of `generateStaticParams`, plus the
 * sitemap) spelled out its own `revalidate`. They agreed, but only by hand.
 */

/**
 * Cache tag shared by every catalog read.
 *
 * The point of the tag is that the catalog's freshness stops being purely a
 * timer. `revalidate` alone is lazy *and* stale-while-revalidate: nothing
 * regenerates until a request arrives after the window has expired, and that
 * request is served the **old** page while the new one builds behind it. On a
 * low-traffic marketing site the person checking whether a new card went live is
 * usually that request — so they see the old library, refresh, and often still
 * see it. It reads as broken rather than as stale.
 *
 * With one tag across every catalog read, a completed sync can call
 * `revalidateTag(CATALOG_CACHE_TAG)` (see app/api/revalidate-catalog/route.ts)
 * and drop the whole catalog — list, categories, card pages and sitemap
 * together — in one go. The timer stays as the backstop for when that call
 * doesn't arrive.
 */
export const CATALOG_CACHE_TAG = "catalog";

/**
 * Every active card. Returns `[]` rather than throwing when the API is
 * unreachable: a marketing page degrades to an empty grid, and a build doesn't
 * fail over it. Callers that need publishable cards only still apply
 * `isPublishableCard` themselves — what "publishable" means differs by surface.
 */
export async function fetchCatalogCards(): Promise<CardDesign[]> {
  return (
    (await publicApiFetch<CardDesign[]>("/card-designs", {
      revalidate: CATALOG_REVALIDATE_SECONDS,
      tags: [CATALOG_CACHE_TAG],
    })) ?? []
  );
}

/** One card by slug (or legacy UUID). Null when it isn't found or the API is down. */
export async function fetchCatalogCard(slugOrId: string): Promise<CardDesign | null> {
  return publicApiFetch<CardDesign>(`/card-designs/${slugOrId}`, {
    revalidate: CATALOG_REVALIDATE_SECONDS,
    tags: [CATALOG_CACHE_TAG],
  });
}
