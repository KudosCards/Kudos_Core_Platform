# 0080 — Signup email confirmation redirects to the wrong domain

## Status

Accepted

## Context

Registering a new account (`/register`) calls `supabase.auth.signUp({ email,
password })` directly in the browser. It passed **no `emailRedirectTo`**, so
Supabase built the confirmation email's redirect from the project's dashboard
**Site URL** — which was still the `*.netlify.app` URL, not the live custom
domain (`kudos-cards.co.uk`).

Two failures resulted:

1. The confirmation link pointed at the wrong (Netlify) origin.
2. More subtly, `/register` stashes the chosen account type + name in
   `localStorage` (`pendingAccount`) and `/onboarding` reads it back to finish
   creating the account after confirmation. Because the confirmation landed on a
   *different origin*, that stash was unreadable there — so **the account was
   never created**.

Every other auth email in the platform (password reset, operator/customer
invites — ADR 0051) is generated *server-side* from the canonical `WEB_APP_URL`
using `auth.admin.generateLink` + a `token_hash` the landing page consumes with
`verifyOtp`. Signup confirmation was the lone exception, fired client-side and
therefore beholden to the dashboard Site URL.

## Decision

Keep signup confirmation client-side (it needs the just-set password's PKCE
context) but make its redirect explicit and same-origin:

- **Pass `emailRedirectTo`** on `signUp`, pointing at a new **`/auth/confirm`**
  route on our own origin.
- **`NEXT_PUBLIC_SITE_URL`** (new, optional web env) provides the canonical
  origin so the redirect is deterministic even if someone registers from a
  preview/mirror; when unset we fall back to `window.location.origin`. A
  `getSiteUrl()` helper centralises this.
- **`/auth/confirm`** establishes the session — reusing the exact logic proven
  in `SetPasswordForm`: consume a `?token_hash=…&type=…` link with `verifyOtp`,
  otherwise let the browser client resolve the PKCE `?code=` / implicit
  fragment on load and wait via `getSession` + `onAuthStateChange` — then
  forwards to `/onboarding`, which finishes account creation from the (now
  same-origin) stash. Expired/used links show a "register again" prompt.

Because the confirmation now returns to our origin, the pending-account stash is
readable and the account is created as intended.

### Required Supabase dashboard configuration (one-time, per environment)

`emailRedirectTo` only works if the target is on the project's **Redirect URLs**
allow-list; otherwise Supabase silently falls back to the Site URL. So the
runbook (§1b) now also requires:

- **Site URL** = the custom domain (`https://kudos-cards.co.uk`).
- **Redirect URLs** include `${WEB_APP_URL}/auth/confirm` (plus the existing
  `/admin-set-password` and `/reset-password`, or a `${WEB_APP_URL}/**` wildcard).
- Web env `NEXT_PUBLIC_SITE_URL` and API env `WEB_APP_URL` both set to the custom
  domain.

## Consequences

- New signups confirm on the correct domain and their account is created.
- No schema/API change; the fix is web-only plus dashboard config. The existing
  `/onboarding` auto-setup path is unchanged — it simply now receives the user
  on the right origin.
- The runbook's misleading "use the live Netlify URL" guidance for Site URL /
  `WEB_APP_URL` is corrected to the custom domain.
- Not changed (deliberate): signup confirmation stays a client-side `signUp`
  rather than being reworked into the server-side `generateLink` pattern —
  that would be a larger refactor of the signup UX for no additional
  correctness once the redirect is pinned.
