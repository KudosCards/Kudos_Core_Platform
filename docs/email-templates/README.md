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
auth emails come from a verified `@kudos-cards.co.uk` sender — the same Brevo
account the app already uses for its own email:

1. Supabase dashboard → **Authentication → Emails → SMTP Settings** → enable
   **Custom SMTP**.
2. Point it at Brevo (`smtp-relay.brevo.com`, port 587) with the Brevo SMTP key,
   and set the **sender** to the same verified address/name as the app's
   `EMAIL_FROM_ADDRESS` / `EMAIL_FROM_NAME` (e.g. `Kudos Cards
<hello@kudos-cards.co.uk>`). The domain must be verified in Brevo (SPF/DKIM)
   — it already is for the app's transactional email.
3. Raise the auth rate limits if needed (the default sender is heavily throttled).

Without this, a perfectly branded template still arrives from a stranger.

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
host that actually serves the asset. (The legacy WordPress store lives at the
un-hyphenated `kudoscards.co.uk`; pointing the logo there 404s it and the email
looks broken.) Override the host with `WEB_APP_URL` when regenerating for another
environment:

```bash
cd apps/api
pnpm build
WEB_APP_URL=https://staging.kudos-cards.co.uk node scripts/generate-auth-email-templates.mjs
```
