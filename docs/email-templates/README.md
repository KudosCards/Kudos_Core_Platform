# Branded email templates

Every outbound Kudos Cards email is rendered from **one** branded shell —
`apps/api/src/email/email-layout.ts` (`renderBrandedEmail`) — so reminders,
receipts, and the Supabase auth emails all look like the same product.

There are two families of outbound email:

| Family                                                                           | Sent by           | Branding source                                                                |
| -------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| **Transactional** — birthday reminders, guest receipts                           | our API (Brevo)   | `email-layout.ts` at runtime, or a Brevo template if configured (see ADR 0025) |
| **Auth** — signup confirmation, magic link, password reset, invite, email change | **Supabase Auth** | the HTML files in this folder, pasted into the Supabase dashboard              |

The auth emails are the highest-volume ones and Supabase sends them directly,
so they can't be branded in code — they're **generated** from the same layout
into static HTML here, then installed by hand.

## ⚠️ First: send from our own domain (the "is this malware?" fix)

Branded HTML is only half the job. By default Supabase sends auth emails from its
**own shared address** (`…@mail.app.supabase.io`) with a generic sender — which
lands in spam and, in the words of a real customer, looks like it "could be
malware". The templates below can't fix the _sender_.

So before (or alongside) installing the templates, configure **custom SMTP** so
auth emails come from a **verified Brevo sender** — the same Brevo account the app
already uses for its own transactional email:

1. Supabase dashboard → **Authentication → Emails → SMTP Settings** → enable
   **Custom SMTP**.
2. Fill in:

   | Field        | Value                                                          |
   | ------------ | -------------------------------------------------------------- |
   | Sender email | `noreply@kudoscards.co.uk`  (see the domain note below)        |
   | Sender name  | `Kudos Cards`                                                  |
   | Host         | `smtp-relay.brevo.com`                                         |
   | Port         | `587`                                                          |
   | Username     | your Brevo **SMTP login** (see gotcha #1)                      |
   | Password     | a Brevo **SMTP key** (Brevo → SMTP & API → SMTP → generate)    |

3. Raise the auth rate limits if needed (the default sender is heavily throttled).

Without this, a perfectly branded template still arrives from a stranger.

### ⚠️ The domain split — sender vs. logo are DIFFERENT domains

This trips people up. The two hosts look almost identical but do different jobs,
and using the wrong one for the sender makes Brevo reject the mail:

| Purpose                          | Domain                            | Why                                                         |
| -------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| **Sending** (SMTP `MAIL FROM`)   | `kudoscards.co.uk` — **no hyphen** | that's where the verified Brevo senders + SPF/DKIM live    |
| **Logo & links inside the email** | `kudos-cards.co.uk` — **hyphen**  | that's the live app host that serves `/marketing/logo.png` |

So an auth email is **sent from** the no-hyphen domain but **shows a logo from**
the hyphen domain. That is intentional — they are genuinely different domains.
The verified Brevo senders are `support@`, `noreply@`, `tech@kudoscards.co.uk`;
use **`noreply@kudoscards.co.uk`** for automated auth mail. Brevo rejects a
`MAIL FROM` that isn't a verified sender even if the domain is verified, so pick
one of those three exactly.

> The app's own `EMAIL_FROM_ADDRESS` env var must likewise be a verified
> `@kudoscards.co.uk` (no-hyphen) sender, or left unset so Brevo falls back to the
> account's default verified sender. It must **not** be a `@kudos-cards.co.uk`
> (hyphenated) address — that domain is not a verified Brevo sender.

### Two gotchas

1. **The SMTP username is the `@smtp-brevo.com` login, not your Brevo account
   email.** Brevo → **SMTP & API → SMTP** shows a "Login" like
   `xxxxxxx@smtp-brevo.com` — that is the SMTP username. Signing in with your
   human account email will fail auth.
2. **Do NOT enable Brevo's "block unauthorized IPs" for SMTP keys.** Supabase
   sends from its own rotating infrastructure IPs that you can't enumerate; IP
   allow-listing will start bouncing all auth mail. Leave it off.

## Installing the auth templates in Supabase

1. Supabase dashboard → **Authentication → Email Templates**.
2. For each template below, paste the matching file's contents into the
   **Message body (HTML)** box and set the **Subject**:

   | Supabase template    | File                  | Subject                            |
   | -------------------- | --------------------- | ---------------------------------- |
   | Confirm signup       | `confirm-signup.html` | Confirm your Kudos Cards account   |
   | Magic Link           | `magic-link.html`     | Your Kudos Cards sign-in link      |
   | Reset Password       | `reset-password.html` | Reset your Kudos Cards password    |
   | Invite user          | `invite.html`         | You've been invited to Kudos Cards |
   | Change Email Address | `change-email.html`   | Confirm your new email address     |

3. Save each one. Send yourself a test (e.g. trigger a password reset) to
   confirm the logo loads and the button works.

The Supabase link variables (`{{ .ConfirmationURL }}`, `{{ .Email }}`,
`{{ .NewEmail }}`) are already embedded in the HTML — don't remove them.

## Regenerating

Never hand-edit the `.html` files — they're generated. Change the copy or
design in the layout / generator and rebuild:

```bash
cd apps/api
pnpm build
node scripts/generate-auth-email-templates.mjs
```

The generator (`apps/api/scripts/generate-auth-email-templates.mjs`) holds the
per-email subject, heading, and body copy. The logo + footer link point at the
**live web app** — `https://kudos-cards.co.uk/marketing/logo.png` — which is the
host that actually serves the asset. (The un-hyphenated `kudoscards.co.uk` is the
legacy WordPress store and does **not** serve `/marketing/logo.png`, so pointing
the logo there 404s it and the email looks broken. Note that same un-hyphenated
domain _is_ the verified Brevo **email-sending** domain — see the domain-split
note above; sender ≠ asset host.) Override the host with `WEB_APP_URL` when
regenerating for another environment:

```bash
cd apps/api
pnpm build
WEB_APP_URL=https://staging.kudos-cards.co.uk node scripts/generate-auth-email-templates.mjs
```
