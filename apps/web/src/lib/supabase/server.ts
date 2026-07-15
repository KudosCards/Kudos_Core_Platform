import { createServerClient, type CookieOptionsWithName } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "../env";

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptionsWithName;
}

/**
 * Supabase client for use in Server Components / Route Handlers / Server
 * Actions. Cookie writes are wrapped in a try/catch per the Supabase SSR
 * docs: Server Components can't set cookies, and that's fine as long as
 * middleware.ts is refreshing the session on every request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — safe to ignore, see doc comment above.
        }
      },
    },
  });
}
