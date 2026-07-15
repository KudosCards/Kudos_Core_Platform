import "server-only";
import { apiFetch } from "./api";
import { createClient as createServerSupabaseClient } from "./supabase/server";

/**
 * Server Component / Server Action convenience wrapper: resolves the
 * current Supabase session and calls apiFetch with its access token.
 * Returns null if there is no session — callers decide how to handle
 * that (middleware already redirects unauthenticated users away from
 * protected routes, so this is a defensive fallback, not the primary guard).
 */
export async function serverApiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return null;
  }

  return apiFetch<T>(path, session.access_token, init);
}
