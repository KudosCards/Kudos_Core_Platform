# ADR 0051 — Operator password setup + platform password reset

Status: accepted
Date: 2026-07-27

## Context

ADR 0040 introduced operator onboarding by **email allow-list**: a super admin
adds an operator's email (`PlatformAdminInvite`), and when that person signs in
at `/admin-login` with a matching verified Supabase email, `POST /admin/access`
provisions them. It rested on the assumption that _"internal staff already have
logins."_

That assumption doesn't hold for a **net-new operator** — someone who was never
a Kudos _customer_ and so has no Supabase auth user. The gaps:

- The invite only wrote an allow-list row and emailed a "go sign in" link. It
  **never created a Supabase user**, so there was no password behind the email.
- `/admin-login` only offers `signInWithPassword` — **no sign-up, no
  set-password, no forgot-password**. A brand-new operator landed on a password
  form with no way to obtain a password, and was stuck.
- The only workaround was to register as a _customer_ at `/register` (creating a
  junk customer `Account` + onboarding), then go to `/admin-login`.
- Separately, there was **no password-reset anywhere in the app** — any user
  (customer or operator) who forgot their password was locked out.

## Decision

Use Supabase's **admin auth API** (service-role) to actually create the operator
and mint a one-time set-password link, delivered through our existing branded
Brevo email; and add a platform-wide password-reset flow. No new secret — the
API already requires `SUPABASE_SERVICE_ROLE_KEY` (used by the storage client).

### Service-role admin client

A global `SUPABASE_ADMIN_CLIENT` provider (`supabase/supabase-admin.provider.ts`),
mirroring the storage client and overridable in tests like `JWKS_RESOLVER`, so
e2e never calls the real Supabase Auth API. A shared `generateAuthLink` helper
wraps `auth.admin.generateLink`, returning `actionLink: null` — rather than
throwing — for the one benign case per link type (see below).

### Operator invite mints a set-password link

`AdminTeamService.invite()`/`resendInvite()` now call
`generateLink({ type: 'invite', … redirectTo: /admin-set-password })`, which
**creates the auth user** and returns a one-time link, and email that link via
the branded template ("Set your password"). If the email is **already
registered**, `generateLink` reports it and we fall back to a
`generateLink({ type: 'recovery', … })` link — which works for an existing user
and still lets them set a password — and email **that** set-password link. Both
link types land on `/admin-set-password`, so the operator always gets a working
"set your password" path regardless of whether they already existed. (An earlier
revision emailed a bare "go and sign in" pointer for existing emails; that
dead-ended a user who existed in Supabase but had **no password** — e.g. one
created by an earlier invite that was never completed — so it was replaced with
the recovery-link fallback.) The allow-list row is unchanged and is still
consumed at `/admin/access` time, so provisioning runs after the password is set.

Swallow-on-`invite` / surface-on-`resend` semantics are preserved: a failed
mint/send doesn't fail the allow-list write (the row is the source of truth, and
resend regenerates), while the explicit Resend action surfaces failures (502).

### Set-password landing page

`/admin-set-password` (web) receives the invite link — Supabase establishes a
session in the URL fragment — waits for it, sets the password via
`supabase.auth.updateUser`, then calls `POST /admin/access` and enters `/admin`.
A shared `SetPasswordForm` component handles session detection + the form.

### Platform-wide password reset (Brevo, not Supabase email)

`POST /auth/request-password-reset` (`@Public()`) mints a
`generateLink({ type: 'recovery', … redirectTo: /reset-password })` and emails
it branded. It **always returns 200** and silently no-ops for unknown addresses
(and logs, never surfaces, send failures) so it can't be used to enumerate which
emails have accounts. `/forgot-password` collects the email; `/reset-password`
reuses `SetPasswordForm` and sends the user to `/login` afterwards. "Forgot your
password?" is linked from both `/login` and `/admin-login`. This keeps **all**
auth emails on our branded Brevo path rather than Supabase's default templates.

## Consequences

- A net-new operator can be onboarded end-to-end: invite → branded email → set a
  password → land in the ops app. No junk customer account, no out-of-band steps.
- Every user now has a self-serve password reset — closing a hard lock-out gap.
- **Deploy step (Supabase dashboard):** `${WEB_APP_URL}/admin-set-password` and
  `${WEB_APP_URL}/reset-password` must be added to Supabase Auth → **Redirect
  URLs**, or Supabase rejects the redirect (analogous to the Stripe/HubSpot
  dashboard steps). Flagged in the go-live runbook.
- **Verification limit:** this sandbox has no network path to Supabase, so real
  link delivery + redemption can only be verified after deploy. Covered here by
  e2e against the mocked `SUPABASE_ADMIN_CLIENT` (invite mints + emails the link,
  existing-user fallback, reset always-200 with no enumeration, malformed-email
  400), full suite green (237 e2e), and a compiled-server boot check.
- Supersedes the ADR 0040 decision that emailed operator invites are "just a
  convenience pointer" and that internal staff already have logins.
