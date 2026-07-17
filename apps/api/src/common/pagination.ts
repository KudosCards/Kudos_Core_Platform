/**
 * Pagination coercion done in plain JS, deliberately NOT via class-transformer's
 * `@Type(() => Number)` on the DTO. Query params arrive as strings, and the
 * decorator-based conversion proved unreliable once compiled/deployed (it
 * silently left `perPage` a string in Railway's build, so `@IsInt`/`@Min`/`@Max`
 * rejected every list request with a 400). Parsing here is build-toolchain
 * independent and can't regress that way. Invalid input clamps to a sane
 * default rather than erroring — a bad page number should never break a list.
 */

export function parsePage(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function parsePerPage(value: unknown, fallback: number, max = 100): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }
  return Math.min(n, max);
}
