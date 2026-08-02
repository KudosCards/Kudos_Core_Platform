import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Canonical public origin of the live web app (e.g. https://kudos-cards.co.uk),
  // used to build the signup-confirmation email's redirect so it always returns
  // to the real domain rather than falling back to the Supabase dashboard "Site
  // URL". Optional: when unset we use the current browser origin. See ADR 0080.
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
});

/**
 * Validated at import time so a missing NEXT_PUBLIC_* var fails loudly in
 * development rather than silently producing `undefined` deep in a fetch call.
 */
export const env = envSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});
