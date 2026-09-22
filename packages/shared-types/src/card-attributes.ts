import { z } from "zod";

/**
 * What a card design says about who it suits.
 *
 * The catalog could not describe itself: a `CardDesign` carried a category, a
 * name, a slug, a SKU and a thumbnail, and nothing that said who a design was
 * for. "Pick a card that fits this person" therefore had nothing to read, and
 * the honest version of it was "pick one of the ones they chose, at random"
 * (ADR 0257). These two columns are the beginning of an answer.
 *
 * Both are authored in Airtable alongside the artwork, because that is where
 * the catalog already lives (ADR 0011) and where the team is already working.
 * Both are nullable: a design nobody has described yet says nothing, rather
 * than claiming to suit everybody.
 *
 * See docs/adr/0259.
 */

/**
 * Who a design suits by age.
 *
 * `any` is the default and expected to be most of the catalog — the useful
 * fact is "this one is specifically for a child", not an age for every card.
 *
 * It degrades safely, which matters more than it looks: a recipient's age is
 * unknowable whenever `birthYearKnown` is false, which is **every CleanCloud
 * contact by design** (ADR 0252) and any CRM whose birthday field carries no
 * year. For that cohort — a large one — an age-matched rule has nothing to
 * match on, and an `any` card is the only safe thing to send.
 */
export const cardAgeBandSchema = z.enum(["any", "child", "teen", "adult"]);
export type CardAgeBand = z.infer<typeof cardAgeBandSchema>;

/**
 * How a design reads.
 *
 * Worth being straight about what this is for. Nothing on a recipient says
 * "likes funny cards", so tone matches nothing at send time today; its value
 * is the public catalog — browsing and the category pages — and, later, a
 * subscriber saying which tones they want their standing order to use.
 */
export const cardToneSchema = z.enum(["funny", "warm", "elegant", "simple"]);
export type CardTone = z.infer<typeof cardToneSchema>;

/** What an operator types in Airtable, mapped onto the vocabulary above.
 *
 * Tolerant for the same reason the column names are (ADR 0011): these are
 * typed by a person into a spreadsheet, and "Kids" meaning `child` is not a
 * data-quality problem worth failing a sync over. Anything unrecognised stays
 * null and is reported, rather than being guessed at. */
const AGE_BAND_ALIASES: Record<string, CardAgeBand> = {
  any: "any",
  "any age": "any",
  anyone: "any",
  all: "any",
  "all ages": "any",
  general: "any",
  child: "child",
  children: "child",
  kid: "child",
  kids: "child",
  "0-12": "child",
  teen: "teen",
  teens: "teen",
  teenager: "teen",
  "13-17": "teen",
  adult: "adult",
  adults: "adult",
  grown: "adult",
  "grown up": "adult",
  "18+": "adult",
};

const TONE_ALIASES: Record<string, CardTone> = {
  funny: "funny",
  humour: "funny",
  humor: "funny",
  humorous: "funny",
  comic: "funny",
  joke: "funny",
  warm: "warm",
  heartfelt: "warm",
  sincere: "warm",
  sentimental: "warm",
  elegant: "elegant",
  classic: "elegant",
  formal: "elegant",
  luxury: "elegant",
  ornate: "elegant",
  simple: "simple",
  minimal: "simple",
  clean: "simple",
  plain: "simple",
  modern: "simple",
};

function lookup<T>(aliases: Record<string, T>, value: string | null | undefined): T | null {
  const key = value?.trim().toLowerCase();
  if (!key) return null;
  return aliases[key] ?? null;
}

/** Parse an upstream age-band cell. Null for empty or unrecognised. */
export function parseCardAgeBand(value: string | null | undefined): CardAgeBand | null {
  return lookup(AGE_BAND_ALIASES, value);
}

/** Parse an upstream tone cell. Null for empty or unrecognised. */
export function parseCardTone(value: string | null | undefined): CardTone | null {
  return lookup(TONE_ALIASES, value);
}

/** Every value an operator may type, for the Airtable single-select and for
 * telling them what we accepted when they typed something else. */
export const CARD_AGE_BAND_VALUES = cardAgeBandSchema.options;
export const CARD_TONE_VALUES = cardToneSchema.options;

/**
 * The age each band starts at, and the one place those numbers live.
 *
 * They are printed in the ops runbook (`docs/ops/catalog-describe-designs.md`)
 * as 0-12, 13-17 and 18+, so an operator deciding what a card is for and the
 * code deciding who gets it have to agree. Two copies of a boundary is how a
 * twelve-year-old gets an adult card.
 */
export const CARD_AGE_BAND_FROM = { teen: 13, adult: 18 } as const;

/**
 * Which band a recipient falls in on a given day, or null when we cannot say.
 *
 * Null is the common case and not an error: a recipient's age is unknowable
 * whenever `birthYearKnown` is false, which is every CleanCloud contact by
 * design (ADR 0252) and any CRM whose birthday field carries no year. A caller
 * must treat null as "no preference", never as a band.
 */
export function recipientAgeBand(
  dateOfBirth: Date | null | undefined,
  birthYearKnown: boolean,
  on: Date,
): Exclude<CardAgeBand, "any"> | null {
  if (!dateOfBirth || !birthYearKnown) {
    return null;
  }
  const years = wholeYearsBetween(dateOfBirth, on);
  if (years < 0) {
    // A birth date in the future is a data error, not a baby. Saying nothing
    // is safer than calling them a child.
    return null;
  }
  if (years < CARD_AGE_BAND_FROM.teen) return "child";
  if (years < CARD_AGE_BAND_FROM.adult) return "teen";
  return "adult";
}

/** Completed years between two dates, in UTC — the birthday has to have been. */
function wholeYearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const monthDiff = to.getUTCMonth() - from.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && to.getUTCDate() < from.getUTCDate())) {
    years -= 1;
  }
  return years;
}
