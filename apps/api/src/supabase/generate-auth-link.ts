import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthLinkType = "invite" | "recovery";

/**
 * Mints a one-time Supabase auth link (service-role `auth.admin.generateLink`)
 * that lands the user on our own `redirectTo` page with a session, where they
 * set a password (`supabase.auth.updateUser`). `invite` also *creates* the auth
 * user; `recovery` targets an existing one.
 *
 * `actionLink` is `null` — rather than throwing — for the one benign case per
 * type where the link simply doesn't apply: an **invite** for an email that's
 * already registered (they have a password; fall back to a plain sign-in
 * pointer), and a **recovery** for an email with no account (a forgot-password
 * request for an unknown address — stay silent so we never leak which emails
 * exist). Any other error is a real failure and is thrown.
 */
export async function generateAuthLink(
  client: SupabaseClient,
  params: { type: AuthLinkType; email: string; redirectTo: string },
): Promise<{ actionLink: string | null }> {
  const { data, error } = await client.auth.admin.generateLink({
    type: params.type,
    email: params.email,
    options: { redirectTo: params.redirectTo },
  });
  if (error) {
    if (isBenignAbsence(params.type, error)) {
      return { actionLink: null };
    }
    throw error;
  }
  return { actionLink: data.properties?.action_link ?? null };
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
