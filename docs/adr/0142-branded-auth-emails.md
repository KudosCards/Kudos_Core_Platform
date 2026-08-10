# 0142 — Branded, trustworthy auth emails (fix the "could this be malware?" signup email)

## Status

Accepted — implemented. From early customer feedback (Wave 1).

## Context

A customer signing up said the **confirmation email** was _"NOTHING branded —
could this be malware?"_

Two separate things make an auth email look untrustworthy, and we were hit by
both:

1. **The sender.** Supabase Auth (GoTrue) sends signup/reset/invite emails
   itself. By default it uses **Supabase's own shared address**
   (`…@mail.app.supabase.io`) with a generic sender — which trips spam filters
   and reads as a stranger. No template change can fix the _from_ line.

2. **The content.** We already generate branded HTML for all five auth emails
   (`docs/email-templates/`, from the same `renderBrandedEmail` layout as the
   app's own email) — but the generator hard-coded the logo host as
   `https://kudoscards.co.uk`. That is the **legacy WordPress store**, not the
   live app (`https://kudos-cards.co.uk`), so the logo `<img>` **404s in every
   auth email** — a broken logo reads exactly like a phishing attempt. The shared
   layout's footer link had the same un-hyphenated domain baked in as its text.

## Decision

Fix the content bug in code, and document the sender fix (which lives in the
Supabase dashboard, not the repo).

### Content (this PR)

- **Generator host corrected + made configurable.**
  `generate-auth-email-templates.mjs` now defaults the logo/footer host to the
  live app `https://kudos-cards.co.uk` and reads `WEB_APP_URL` for other
  environments. The five committed templates were regenerated — the logo now
  loads.
- **Footer link text derives from the host.** `email-layout.ts` builds the footer
  link label from `webAppUrl` instead of a hard-coded domain, so the visible text
  always matches where the link goes — for **every** email (auth and the app's
  own transactional mail), and it can never drift from the deployed host again.

### Sender (operational — documented, not code)

The real "not malware" fix is **custom SMTP** in Supabase so auth emails come
from the same verified `@kudos-cards.co.uk` Brevo sender the app already uses.
This can't live in the repo (there is no `supabase/config.toml` — auth is
dashboard-configured), so it's a first-class, prominent step in
`docs/email-templates/README.md`: enable Custom SMTP → Brevo relay → verified
sender + name matching `EMAIL_FROM_ADDRESS`/`EMAIL_FROM_NAME`.

## Consequences

- Once the templates are pasted in **and** custom SMTP is configured, the signup
  confirmation (and reset/magic-link/invite/change-email) arrive branded, with a
  working logo, from a recognisable `@kudos-cards.co.uk` address — no longer
  "could this be malware".
- The domain fix also quietly corrects the footer link on the app's own
  transactional emails.
- No schema change, no migration. The apply steps (templates + SMTP) are a
  dashboard task captured in the templates README.

## Follow-up

Regenerating the templates currently needs a human to re-paste them into the
Supabase dashboard. If we later adopt the Supabase CLI with a committed
`config.toml`, the templates + SMTP settings could be version-controlled and
applied on deploy — worth revisiting, out of scope here.
