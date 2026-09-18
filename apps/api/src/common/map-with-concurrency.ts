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

/**
 * `items` split into consecutive runs of at most `size`, in order.
 *
 * Exists for the pattern of "do the slow part of a batch concurrently, then the
 * contended part one at a time": a whole-batch split would do every slow call
 * before the first cheap one, which wastes the work when the batch stops early.
 * A window keeps both halves and bounds the waste to one window.
 *
 * A `size` below 1 would loop forever, so it yields everything in one run
 * instead — no windowing, which is the safe reading of a nonsense window.
 */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  if (items.length === 0) return [];
  if (size < 1) return [[...items]];
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}
