import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthLinkType = "invite" | "recovery";

/**
 * Mints a one-time Supabase auth token (service-role `auth.admin.generateLink`)
 * for a set-password flow. `invite` also *creates* the auth user; `recovery`
 * targets an existing one.
 *
 * We return the **`hashedToken`**, not the ready-made `actionLink`. The callers
 * build their own link to one of our pages carrying `?token_hash=…&type=…`, and
 * that page verifies it client-side with `supabase.auth.verifyOtp`. This is
 * deliberate and fixes two real production failures of the old action_link
 * approach (see docs/adr/0051):
 *   1. Our browser client uses the PKCE flow, but a service-role-generated link
 *      has no PKCE code verifier in the user's browser, so the redirect could
 *      never establish a session — the page dead-ended at "invalid link".
 *   2. The action_link is a one-time GET; business email scanners (Microsoft
 *      SafeLinks, Mimecast, …) pre-fetch links and burn the token before the
 *      user clicks, giving "already been used". A token_hash on our own page is
 *      only consumed by the JS `verifyOtp` call, which scanners don't trigger.
 *
 * `hashedToken` is `null` — rather than throwing — for the one benign case per
 * type where the link doesn't apply: an **invite** for an already-registered
 * email, and a **recovery** for an email with no account (stay silent so we
 * never leak which emails exist). Any other error is a real failure and thrown.
 */
export async function generateAuthLink(
  client: SupabaseClient,
  params: { type: AuthLinkType; email: string; redirectTo: string },
): Promise<{ hashedToken: string | null }> {
  const { data, error } = await client.auth.admin.generateLink({
    type: params.type,
    email: params.email,
    options: { redirectTo: params.redirectTo },
  });
  if (error) {
    if (isBenignAbsence(params.type, error)) {
      return { hashedToken: null };
    }
    throw error;
  }
  return { hashedToken: data.properties?.hashed_token ?? null };
}

/** Whether an error is the expected "this link doesn't apply" case for the type
 * (invite → already registered; recovery → no such user), matched on Supabase's
 * error code with a message fallback for older gotrue versions. */
function isBenignAbsence(type: AuthLinkType, error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  if (type === "invite") {
    return (
      code === "email_exists" ||
      message.includes("already been registered") ||
      message.includes("already registered") ||
      message.includes("already exists")
    );
  }
  return (
    code === "user_not_found" || message.includes("user not found") || message.includes("no user")
  );
}
