import { createBrowserClient } from "@supabase/ssr";
import { env } from "../env";

/** Supabase client for use in Client Components. */
export function createClient() {
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
