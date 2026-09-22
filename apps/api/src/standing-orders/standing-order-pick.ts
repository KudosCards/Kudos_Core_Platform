import type { CardAgeBand } from "@kudos/shared-types";

/**
 * Which card, and which message, a given birthday gets.
 *
 * Two properties matter more than cleverness, and they are why this is a hash
 * rather than a random number:
 *
 *  - **Deterministic.** The same inputs always give the same card, so a run
 *    that is retried cannot silently change what somebody is sent, and a test
 *    can assert a card rather than a distribution.
 *  - **Spread, and not repeating.** Everybody must not get design #1, and the
 *    same person should not get the same card two years running — the one
 *    repetition a recipient would actually notice. The year is in the seed.
 *
 * The design pick now reads the catalog's own description of itself (ADR 0259)
 * where there is one. The message pick does not: nothing on a recipient says
 * which of a subscriber's messages suits them, so it varies and no more.
 *
 * See docs/adr/0257 and docs/adr/0260.
 */

/** FNV-1a, 32-bit. Small, stable, and not a security primitive — nothing here
 * depends on it being hard to reverse, only on it being well spread. */
function hash(seed: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    // The FNV prime, via shifts, so the arithmetic stays in 32 bits.
    value =
      (value + ((value << 1) + (value << 4) + (value << 7) + (value << 8) + (value << 24))) >>> 0;
  }
  return value >>> 0;
}

/** One of `items`, chosen deterministically for this seed. */
function pick<T>(items: readonly T[], seed: string): T {
  if (items.length === 0) {
    throw new Error("Cannot pick from an empty pool");
  }
  return items[hash(seed) % items.length]!;
}

/** A design in the pool, with whatever the catalog says about it. */
export interface PoolDesign {
  savedDesignId: string;
  /** Null when nobody has described the design it came from — not the same as
   * `any`, which is somebody saying it suits everybody (ADR 0259). */
  ageBand: CardAgeBand | null;
}

/**
 * Rank the pool for a recipient whose age band is `band` (null when unknown).
 *
 * Tiers, best first. The rule is **prefer, never exclude**: a nursery whose
 * whole pool is `child` cards must still get cards for a contact whose age we
 * do not know, so an unmatched tier is a last resort rather than a filter.
 */
function tiersFor(pool: readonly PoolDesign[], band: CardAgeBand | null): PoolDesign[][] {
  const matching = band ? pool.filter((design) => design.ageBand === band) : [];
  const anyone = pool.filter((design) => design.ageBand === "any");
  const undescribed = pool.filter((design) => design.ageBand === null);
  const rest = pool.filter(
    (design) =>
      design.ageBand !== null && design.ageBand !== "any" && (!band || design.ageBand !== band),
  );
  // Undescribed before a mismatched band: silence is a smaller risk than a card
  // somebody explicitly marked for a different age.
  return [matching, anyone, undescribed, rest];
}

/**
 * Pick one design for this recipient.
 *
 * `pool` must be non-empty; the caller has already refused to run an
 * instruction with an empty pool.
 */
export function pickStandingOrderDesign(
  pool: readonly PoolDesign[],
  recipientId: string,
  occasionDate: Date,
  band: CardAgeBand | null = null,
): string {
  if (pool.length === 0) {
    throw new Error("Cannot pick a design from an empty pool");
  }
  const best = tiersFor(pool, band).find((tier) => tier.length > 0) ?? pool;
  return pick(best, `${recipientId}:${occasionDate.getUTCFullYear()}`).savedDesignId;
}

/**
 * Pick one message for this recipient.
 *
 * Salted differently from the design pick so the two do not move together: with
 * the same seed, a pool of four designs and four messages would only ever
 * produce four of the sixteen pairings, and the same person would get the same
 * combination every time the pools happened to be the same length.
 */
export function pickStandingOrderMessage(
  messageIds: readonly string[],
  recipientId: string,
  occasionDate: Date,
): string {
  if (messageIds.length === 0) {
    throw new Error("Cannot pick a message from an empty pool");
  }
  return pick(messageIds, `message:${recipientId}:${occasionDate.getUTCFullYear()}`);
}
