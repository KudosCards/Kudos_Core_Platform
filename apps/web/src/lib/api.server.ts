import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { apiFetch } from "./api";
import { createClient as createServerSupabaseClient } from "./supabase/server";

interface SessionInfo {
  accessToken: string;
  userId: string;
}

/**
 * Resolve the current user's session, deduped per render via React's `cache()`.
 * A single authenticated route makes several serverApiFetch calls — the (app)
 * layout fetches account + badges, then the page fetches its own data — and each
 * previously recreated the Supabase server client and re-read the session
 * cookie. Wrapping it here collapses all of those into one client creation +
 * session read per request. See docs/adr/0042-performance.md.
 */
const getSessionInfo = cache(async (): Promise<SessionInfo | null> => {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  return { accessToken: session.access_token, userId: session.user.id };
});

/**
 * Server Component / Server Action convenience wrapper: resolves the
 * current Supabase session and calls apiFetch with its access token.
 * Returns null if there is no session — callers decide how to handle
 * that (middleware already redirects unauthenticated users away from
 * protected routes, so this is a defensive fallback, not the primary guard).
 */
export async function serverApiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const session = await getSessionInfo();
  if (!session) {
    return null;
  }
  return apiFetch<T>(path, session.accessToken, init);
}

/**
 * Like `serverApiFetch`, but the response is cached on the Next server for
 * `revalidateSeconds`, **scoped to this user** (the cache key includes the
 * user id, so one account can never see another's data). Use this ONLY for
 * low-churn, per-user reads that the app shell fetches on *every* navigation —
 * currently just `/accounts/me` (name + plan, which change rarely). It removes
 * that round-trip (Netlify→Railway→Postgres) from the critical path of every
 * page load once warm.
 *
 * Deliberately NOT used for the nav badges or any list data: those change on
 * user actions and must stay fresh, so they'd show a stale count for up to the
 * TTL after a mutation (`router.refresh()` can't bust a Next data-cache entry
 * because our mutations go through the Nest API, not a Server Action /
 * revalidateTag). See docs/adr/0076-app-shell-perf.md.
 */
export async function cachedServerApiFetch<T>(
  path: string,
  revalidateSeconds: number,
): Promise<T | null> {
  const session = await getSessionInfo();
  if (!session) {
    return null;
  }
  const { accessToken, userId } = session;
  const load = unstable_cache(
    // The token is captured, not part of the key: within the TTL a cache hit
    // reuses the stored result and never re-sends a (possibly rotated) token.
    async () => apiFetch<T>(path, accessToken),
    ["api", path, userId],
    { revalidate: revalidateSeconds },
  );
  return load();
}
