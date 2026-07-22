# Branded email templates

Every outbound Kudos Cards email is rendered from **one** branded shell —
`apps/api/src/email/email-layout.ts` (`renderBrandedEmail`) — so reminders,
receipts, and the Supabase auth emails all look like the same product.

There are two families of outbound email:

| Family | Sent by | Branding source |
| --- | --- | --- |
| **Transactional** — birthday reminders, guest receipts | our API (Brevo) | `email-layout.ts` at runtime, or a Brevo template if configured (see ADR 0025) |
| **Auth** — signup confirmation, magic link, password reset, invite, email change | **Supabase Auth** | the HTML files in this folder, pasted into the Supabase dashboard |

The auth emails are the highest-volume ones and Supabase sends them directly,
so they can't be branded in code — they're **generated** from the same layout
into static HTML here, then installed by hand.

## Installing the auth templates in Supabase

1. Supabase dashboard → **Authentication → Email Templates**.
2. For each template below, paste the matching file's contents into the
   **Message body (HTML)** box and set the **Subject**:

   | Supabase template | File | Subject |
   | --- | --- | --- |
   | Confirm signup | `confirm-signup.html` | Confirm your Kudos Cards account |
   | Magic Link | `magic-link.html` | Your Kudos Cards sign-in link |
   | Reset Password | `reset-password.html` | Reset your Kudos Cards password |
   | Invite user | `invite.html` | You've been invited to Kudos Cards |
   | Change Email Address | `change-email.html` | Confirm your new email address |

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
per-email subject, heading, and body copy. The logo is loaded from
`https://kudoscards.co.uk/marketing/logo.png`; if the web app moves hosts,
update `WEB_APP_URL` in the generator and regenerate.
