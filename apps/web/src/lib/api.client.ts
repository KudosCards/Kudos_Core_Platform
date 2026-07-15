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
    throw new Error("No active session — redirecting to login should have happened already");
  }

  return apiFetch<T>(path, session.access_token, init);
}
