import { env } from "./env";
import { ApiError } from "./api";

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
