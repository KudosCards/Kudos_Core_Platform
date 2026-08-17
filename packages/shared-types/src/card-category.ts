/**
 * The public card-category vocabulary, and how upstream category strings map
 * onto it.
 *
 * The catalog's `category` is uncontrolled text: the Airtable sync lowercases
 * whatever is in the "Occasion" field and falls back to `"uncategorised"`
 * (apps/api/src/catalog/airtable-catalog-source.ts). That is fine for browsing,
 * but it can't be published — a typo would mint an indexed landing page, and
 * `thank_you` would reach a customer as "Thank_you".
 *
 * So this module is the allowlist. A category here has a canonical slug, a
 * display name and a landing page; anything else still syncs and is still
 * browsable through the on-page filter, but publishes nothing.
 *
 * See docs/adr/0163-catalog-urls-and-category-pages.md.
 */

export interface CardCategory {
  /** URL segment — `/cards/<slug>`. Stable; changing one needs a 301. */
  slug: string;
  /** Customer-facing name, used for headings, chips and breadcrumbs. */
  name: string;
  /** Title/description for the category landing page. */
  title: string;
  description: string;
  /**
   * Upstream `category` values that mean this category, lowercased. The
   * canonical slug and the name are matched automatically, so only genuine
   * variants need listing.
   */
  aliases: string[];
}

export const CARD_CATEGORIES: readonly CardCategory[] = [
  {
    slug: "birthday",
    name: "Birthday",
    title: "Birthday cards, printed and posted for you",
    description:
      "Personalised birthday cards for customers, students, members and staff. Pick a design, add your message, and we print and post a real card.",
    aliases: ["birthdays", "happy birthday"],
  },
  {
    slug: "thank-you",
    name: "Thank You",
    title: "Thank you cards, printed and posted for you",
    description:
      "Personalised thank you cards for the people who matter to your business. We print and post real cards, so a thank-you lands on the doormat.",
    aliases: ["thank you", "thank_you", "thankyou", "thanks"],
  },
  {
    slug: "congratulations",
    name: "Congratulations",
    title: "Congratulations cards, printed and posted for you",
    description:
      "Personalised congratulations cards for exam results, promotions and milestones. We print and post a real card for every recipient.",
    aliases: ["congratulation", "congrats", "well done", "well_done", "welldone"],
  },
  {
    slug: "achievement",
    name: "Achievement",
    title: "Achievement cards, printed and posted for you",
    description:
      "Personalised achievement cards to recognise progress and effort. Ideal for tuition centres, schools and clubs — printed and posted for you.",
    aliases: ["achievements", "award", "awards"],
  },
  {
    slug: "academic",
    name: "Academic",
    title: "Academic cards, printed and posted for you",
    description:
      "Personalised academic cards for results days, graduations and end of term. We print and post a real card to each student's home.",
    aliases: ["academics", "school", "graduation", "exam", "exams"],
  },
  {
    slug: "funny",
    name: "Funny",
    title: "Funny cards, printed and posted for you",
    description:
      "Personalised funny cards for the people who'd rather laugh than be congratulated. Printed and posted for you.",
    aliases: ["humour", "humor", "joke"],
  },
];

/** Lookup by canonical slug. */
export function getCardCategory(slug: string): CardCategory | undefined {
  return CARD_CATEGORIES.find((category) => category.slug === slug);
}

/**
 * Resolve an upstream catalog `category` string onto the vocabulary, or
 * `undefined` when it isn't one we publish.
 *
 * Matching is deliberately forgiving — case, surrounding whitespace, and
 * `_`/space/`-` are all normalised — because the upstream value is typed by
 * hand. It is *not* fuzzy: an unrecognised value returns undefined rather than
 * guessing, so a typo stays unpublished instead of landing in the wrong bucket.
 */
export function resolveCardCategory(rawCategory: string): CardCategory | undefined {
  const normalised = normaliseCategoryKey(rawCategory);
  if (normalised === "") return undefined;

  return CARD_CATEGORIES.find(
    (category) =>
      normaliseCategoryKey(category.slug) === normalised ||
      normaliseCategoryKey(category.name) === normalised ||
      category.aliases.some((alias) => normaliseCategoryKey(alias) === normalised),
  );
}

/** Display name for an upstream category, falling back to a tidied version of
 * the raw value so an unpublished category still reads properly in the app. */
export function cardCategoryLabel(rawCategory: string): string {
  const known = resolveCardCategory(rawCategory);
  if (known) return known.name;

  const words = rawCategory.trim().replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "Uncategorised";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** `"Thank_You "` → `"thank you"`. Internal to the matching above. */
function normaliseCategoryKey(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * URL slug for a card design's name — `"Simple Happy Birthday Fun!"` →
 * `"simple-happy-birthday-fun"`.
 *
 * Assigned once, when a design is first synced, and never recomputed: a slug
 * that tracked the name would break every indexed URL and every QR-carrying card
 * already in the post the moment ops fixed a typo. See ADR 0163.
 *
 * Accented characters are folded to ASCII so a name like "Fête" produces a
 * usable slug rather than an empty one. If nothing usable survives (a name of
 * only symbols, say), the caller gets `""` and is expected to fall back — the
 * sync uses the design's SKU or external id.
 */
export function slugifyCardName(name: string): string {
  return (
    name
      .normalize("NFKD")
      // Strip combining marks left behind by the decomposition (é → e + ́ → e).
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "")
  );
}

/**
 * Append `-2`, `-3`, … until the slug is unused. `taken` is the set of slugs
 * already assigned; the database's unique index is the real backstop.
 */
export function uniqueCardSlug(base: string, taken: ReadonlySet<string>): string {
  if (base === "") throw new Error("uniqueCardSlug requires a non-empty base slug");
  if (!taken.has(base)) return base;

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
