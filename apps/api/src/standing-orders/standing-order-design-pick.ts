/**
 * Which of the pooled designs a given card gets.
 *
 * This is a placeholder with its eyes open. The real rule — "pick a card that
 * suits this person" — needs attributes on both sides, and today there are
 * none: a `CardDesign` carries a category, a name, a slug, a SKU and a
 * thumbnail, and nothing that says who it suits. Describing the catalog is C3,
 * and the rule that reads those descriptions is C5.
 *
 * Until then the honest version of "pick a card" is "pick one of the ones they
 * chose", and the only two things worth getting right are:
 *
 *  - **Spread.** Everybody must not get design #1. A hash of the recipient
 *    scatters the pool across the account.
 *  - **Not the same card twice running.** The year is in the seed, so the same
 *    person gets a different card next birthday — which is the one repetition a
 *    recipient would actually notice.
 *
 * Deterministic on purpose: the same inputs always give the same card, so a run
 * that is retried does not silently change what somebody is sent, and a test
 * can assert a card rather than a distribution.
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

/**
 * Pick one design id from the pool for this recipient and this occasion date.
 *
 * `poolIds` must be in the subscriber's chosen order and non-empty; the caller
 * has already refused to run an instruction with an empty pool.
 */
export function pickStandingOrderDesign(
  poolIds: readonly string[],
  recipientId: string,
  occasionDate: Date,
): string {
  if (poolIds.length === 0) {
    throw new Error("Cannot pick a design from an empty pool");
  }
  const year = occasionDate.getUTCFullYear();
  const index = hash(`${recipientId}:${year}`) % poolIds.length;
  return poolIds[index]!;
}
