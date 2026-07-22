import { env } from "./env";

/**
 * Unauthenticated GET against the API, for the public card library
 * ("browse before you sign up"). Only the `@Public()` catalog routes
 * (`/card-designs`) are reachable this way — everything else 401s. Server- and
 * client-safe (no next/headers, no Supabase session). Returns null on any
 * failure so a public marketing page degrades to an empty grid rather than
 * throwing. See docs/adr/0017-public-card-library.md.
 */
export async function publicApiFetch<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
