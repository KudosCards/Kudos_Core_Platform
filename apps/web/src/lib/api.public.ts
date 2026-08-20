import { env } from "./env";
import { ApiError } from "./api";

/**
 * ISR window for the public card catalog. The catalog is identical for every
 * visitor and only changes on a catalog sync (nightly / ops-triggered), so an
 * hour of CDN caching is safe and takes a live DB hit off every marketing-page
 * visit. Keep the segment-level `export const revalidate` on the /cards pages in
 * sync with this value. See docs/adr/0044-public-catalog-isr.md.
 */
export const CATALOG_REVALIDATE_SECONDS = 3600;

/**
 * Unauthenticated GET against the API, for the public card library
 * ("browse before you sign up"). Only the `@Public()` catalog routes
 * (`/card-designs`) are reachable this way — everything else 401s. Server- and
 * client-safe (no next/headers, no Supabase session). Returns null on any
 * failure so a public marketing page degrades to an empty grid rather than
 * throwing. See docs/adr/0017-public-card-library.md.
 *
 * By default the request is uncached (`no-store`) — correct for the per-token
 * reads (invites, guest claims, RTS) that also use this helper. Pass a
 * `revalidate` window to opt a read into Next's Data Cache instead; only the
 * public catalog does this (see CATALOG_REVALIDATE_SECONDS).
 *
 * Cached reads may also carry `tags`, which is what lets a catalog sync publish
 * immediately instead of waiting out the window — see `lib/catalog.ts`. Prefer
 * the helpers there over calling this with a hand-written tag.
 */
export async function publicApiFetch<T>(
  path: string,
  options?: { revalidate?: number; tags?: string[] },
): Promise<T | null> {
  try {
    const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
      ...(options?.revalidate !== undefined
        ? {
            next: {
              revalidate: options.revalidate,
              // Tags only mean anything on a cached fetch, so they ride with
              // `revalidate` rather than being a third independent option.
              ...(options.tags ? { tags: options.tags } : {}),
            },
          }
        : { cache: "no-store" }),
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Unauthenticated POST against a `@Public()` API route — used by guest checkout
 * (`POST /guest/checkout`). Unlike publicApiFetch it throws an ApiError on
 * failure so the form can surface the message (a payment flow must not fail
 * silently). See docs/adr/0025.
 */
export async function publicApiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : "Something went wrong — please try again.";
    throw new ApiError(message, response.status, payload);
  }
  return payload as T;
}
