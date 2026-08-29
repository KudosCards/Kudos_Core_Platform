/**
 * The `NEXT_PUBLIC_*` values the app's env schema insists on at import time.
 *
 * `src/lib/env.ts` parses on import and throws when one is missing — deliberate,
 * so a missing variable fails loudly in development instead of surfacing as
 * `undefined` deep inside a fetch. That means any component reaching `@/lib/api`
 * needs them present before its module graph loads, which is why this runs in
 * `setupFiles` rather than `setupFilesAfterEnv`.
 *
 * Committed rather than kept in a `.env.test`, because `.env*` is gitignored:
 * a local-only file would pass here and fail in CI. Every value is a visible
 * placeholder — nothing here is, or should ever be, a real credential. No
 * component test may talk to a real service, so a working key would be a
 * liability rather than a convenience.
 */
process.env.NEXT_PUBLIC_API_URL ??= "http://localhost:3001";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "not-a-real-key-for-component-tests";
