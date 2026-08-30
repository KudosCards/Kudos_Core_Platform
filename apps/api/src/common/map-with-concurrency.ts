/**
 * Run `fn` over `items` with at most `limit` in flight at once.
 *
 * `Promise.all(items.map(...))` starts everything at once. For a few dozen that
 * is fine; for one row per line of an uploaded CSV it exhausts the Prisma
 * connection pool and stalls every other request on the instance — the work
 * finishes no faster and everyone else waits.
 *
 * Lifted out of catalog-sync.service.ts, which had the only copy, so the CSV
 * import can use the same one rather than grow a second. See ADR 0207.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}
