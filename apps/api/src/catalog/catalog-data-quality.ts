/**
 * What the catalog data itself can be wrong about, as facts the sync can state
 * about the records it just pulled.
 *
 * None of these corrupt anything — they are all fixed in Airtable, not in code
 * — and that is exactly why they go unnoticed. Each one costs something
 * specific, named beside it.
 *
 * Pure. See docs/card-artwork-shape-plan.md.
 */

import { resolveCardCategory, slugifyCardName } from "@kudos/shared-types";

/**
 * Product codes carried by more than one card.
 *
 * Nothing in the platform is keyed on `sku`: the sync upserts on the Airtable
 * record id, and a card's URL is derived from its name. So a duplicate corrupts
 * nothing and breaks no link — which is exactly why it goes unnoticed.
 *
 * What it breaks is every report *about* the catalog. Each ops surface names a
 * card as "Title (SKU)", and the artwork worklist this sync now produces is, in
 * practice, a list of codes to hand to whoever makes the artwork. Three rows
 * sharing `KC-INSPIRATIONAL-GEN-011` cannot be worked from: finishing one looks
 * identical to finishing all three.
 *
 * Reported over the records as fetched, including any the sync went on to skip,
 * because the statement is about the Airtable table — which is where the fix
 * is.
 */

export interface DuplicateSku {
  /** The code, as it was typed on the first card carrying it. */
  sku: string;
  designs: { externalId: string; title: string }[];
}

/** The parts of a fetched catalog record these checks read. */
export interface CatalogRecordFacts {
  externalId: string;
  title: string;
  sku: string | null;
  category: string;
}

export function duplicateSkus(records: readonly CatalogRecordFacts[]): DuplicateSku[] {
  const byCode = new Map<string, DuplicateSku>();

  for (const record of records) {
    const trimmed = record.sku?.trim() ?? "";
    // An absent code is not a shared one. Grouping the blanks would report every
    // seeded template and every Airtable row with the column empty as a
    // duplicate of all the others — a false alarm the size of the catalog.
    if (trimmed === "") continue;

    // Matched loosely, because a product code is the same code whatever casing
    // or stray spaces a spreadsheet left on it; reported as typed, so an
    // operator can find the row it came from.
    const key = trimmed.toLowerCase();
    const group = byCode.get(key) ?? { sku: trimmed, designs: [] };
    group.designs.push({ externalId: record.externalId, title: record.title });
    byCode.set(key, group);
  }

  return Array.from(byCode.values())
    .filter((group) => group.designs.length > 1)
    .sort((a, b) => b.designs.length - a.designs.length || a.sku.localeCompare(b.sku));
}

export interface DuplicateName {
  /** The slug both cards want, and which only one of them can have. */
  slug: string;
  designs: { externalId: string; title: string }[];
}

/**
 * Cards whose names collide on the URL slug.
 *
 * This is the one with a permanent, customer-visible consequence. A design's
 * slug is derived from its name and **assigned once, never recomputed** (ADR
 * 0163): recomputing would break every indexed URL and every QR code already in
 * the post. So when two cards slugify the same, `uniqueCardSlug` gives the
 * second one `-2` and it keeps it for good — that is the card's address even
 * after somebody renames it.
 *
 * Grouped by the slug rather than the raw name, because that is the collision
 * that actually happens: `slugifyCardName` folds case, accents and punctuation,
 * so "Well Done — Flowers" and "well done flowers" are the same address.
 */
export function duplicateNames(records: readonly CatalogRecordFacts[]): DuplicateName[] {
  const bySlug = new Map<string, DuplicateName>();
  for (const record of records) {
    const slug = slugifyCardName(record.title);
    // A name that slugifies to nothing falls back to the SKU and then the
    // record id, so it cannot collide on the name at all.
    if (slug === "") continue;
    const group = bySlug.get(slug) ?? { slug, designs: [] };
    group.designs.push({ externalId: record.externalId, title: record.title });
    bySlug.set(slug, group);
  }
  return Array.from(bySlug.values())
    .filter((group) => group.designs.length > 1)
    .sort((a, b) => b.designs.length - a.designs.length || a.slug.localeCompare(b.slug));
}

export interface UnpublishedCategory {
  /** The upstream value, as typed. */
  category: string;
  count: number;
}

/**
 * Upstream categories that are not in the published vocabulary.
 *
 * These cards are **not** broken and **not** hidden: they sync, they are
 * browsable, and their own pages are indexable. What they do not get is a
 * category landing page — they live under `/cards/other/<slug>` instead, and
 * "other" is deliberately noindex because nobody searches for it.
 *
 * So this is not a defect report; it is a list of landing pages the catalog is
 * asking for. A dozen Christmas cards under "other" means there is no
 * `/cards/christmas` for anyone to find, which is worth deciding on purpose
 * rather than by not noticing. Either add the category to `CARD_CATEGORIES` or
 * correct the upstream value — see ADR 0163.
 */
export function unpublishedCategories(
  records: readonly CatalogRecordFacts[],
): UnpublishedCategory[] {
  const counts = new Map<string, UnpublishedCategory>();
  for (const record of records) {
    if (resolveCardCategory(record.category)) continue;
    const key = record.category.trim().toLowerCase();
    const entry = counts.get(key) ?? { category: record.category.trim(), count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return Array.from(counts.values()).sort(
    (a, b) => b.count - a.count || a.category.localeCompare(b.category),
  );
}
