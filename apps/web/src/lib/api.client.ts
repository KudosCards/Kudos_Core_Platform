"use client";

import { apiFetch } from "./api";
import { createClient } from "./supabase/client";

/** Client Component convenience wrapper: resolves the browser session and calls apiFetch. */
export async function clientApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    // The middleware only guards navigation, not calls made from an
    // already-mounted Client Component — a session that expires while the
    // user is active on a page needs to be handled here too, or every
    // caller's catch block was showing a permanent, misleading generic
    // error instead of ever getting the user back to a working state.
    window.location.assign("/login");
    throw new Error("Session expired — redirecting to login");
  }

  return apiFetch<T>(path, session.access_token, init);
}
