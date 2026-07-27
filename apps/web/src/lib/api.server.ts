import "server-only";
import { cache } from "react";
import { apiFetch } from "./api";
import { createClient as createServerSupabaseClient } from "./supabase/server";

/**
 * Resolve the current user's access token, deduped per render via React's
 * `cache()`. A single authenticated route makes several serverApiFetch calls —
 * the (app) layout fetches account + summary, then the page fetches its own
 * data — and each previously recreated the Supabase server client and re-read
 * the session cookie. Wrapping it here collapses all of those into one client
 * creation + session read per request. See docs/adr/0042-performance.md.
 */
const getAccessToken = cache(async (): Promise<string | null> => {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
});

/**
 * Server Component / Server Action convenience wrapper: resolves the
 * current Supabase session and calls apiFetch with its access token.
 * Returns null if there is no session — callers decide how to handle
 * that (middleware already redirects unauthenticated users away from
 * protected routes, so this is a defensive fallback, not the primary guard).
 */
export async function serverApiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    return null;
  }

  return apiFetch<T>(path, accessToken, init);
}
