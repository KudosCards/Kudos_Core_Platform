/**
 * Run `fn` over `items` with at most `limit` in flight at once, returning the
 * results in the order of `items` — not the order they finished.
 *
 * `Promise.all(items.map(...))` starts everything at once. For a few dozen that
 * is fine; for one row per line of an uploaded CSV, or one pair of queries per
 * saved smart list on a page load, it exhausts the Prisma connection pool and
 * stalls every other request on the instance — the work finishes no faster and
 * everyone else waits.
 *
 * Lifted out of catalog-sync.service.ts, which had the only copy, so the CSV
 * import can use the same one rather than grow a second. See ADR 0207.
 */
export async function mapWithConcurrency<T, R = void>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      // Written by index, so a slow item can't reorder the results.
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
