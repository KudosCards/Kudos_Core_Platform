# 0267 — Why an email does not arrive

## Status

Accepted

## Context

A subscriber reported that neither the password-reset email nor the signup
confirmation reached his inbox. Brevo, the Supabase user record, custom SMTP and
the blocklist were all checked by hand and were healthy.

That is the interesting part. Every place an operator would look said the system
was working, which is a property of the code rather than a coincidence: the
email surface had several failure modes that leave no trace anywhere — not in
Brevo, not in the logs, not on the screen.

This is a review of that whole surface. Thirteen findings, each verified
individually; two were reproduced empirically before being believed.

## Decision

### The two that explain the report

**A confirmation link dead-ended.** `/auth/confirm` — where Supabase sends
somebody after they confirm their address — was not in the proxy's public-path
list, and the middleware matcher covers it. The person clicking that link has no
session yet; minting one is what the page is _for_. So the proxy redirected them
to `/login` before the page ran. Missing from the day the page was written.

**What that does and does not break**, stated precisely, because the first
draft of this ADR overstated it. The committed signup template uses
`{{ .ConfirmationURL }}`, which points at Supabase's own `/auth/v1/verify`
endpoint — and that endpoint **confirms the address and then redirects**. The
confirmation itself therefore succeeds before our proxy ever sees the request.
What is lost is the hand-off: the code is never exchanged for a session,
`/onboarding` is never reached directly, and the pending-account stash is never
read there.

The person lands on a login page with no explanation, which reads as "the link
didn't work". If they log in anyway, on the same browser, it recovers — the app
shell turns the account's 403 into a redirect to `/onboarding`, which finds the
stash in local storage and creates the account. On a different device the stash
is gone and onboarding asks again. If they give up at the login page, which is
the natural reading, they are stuck believing signup failed.

Worth separating: `/reset-password` and `/admin-set-password` were already
public, and those carry a `token_hash` that only our own page spends (ADR
0051). A bounce there really would have left the token unspent. It did not
happen, and that is luck rather than design — which is why this list is now
tested rather than remembered.

The list is now its own module with no `next/server` import, and a test names
every logged-out landing page — because the cost of a missing entry is silent
and lands on support as "the email doesn't work".

**Signing up again sends nothing, and we said it did.** With Supabase's
email-enumeration protection on (the default), `signUp` with an address that
already has an account returns no error, no session, and a user carrying **no
identities**. No email is sent. The register page keyed only on `!data.session`,
so it told that person to check their inbox.

It now detects the empty `identities` and offers to log in or reset the
password. Deliberately without confirming that the address is registered: ADR
0051 keeps that undiscoverable at the reset endpoint, and this page must not
become the oracle that one refuses to be. The invite page had the same trap and
also omitted `emailRedirectTo`, re-breaking ADR 0080.

### The one that would hide a Brevo failure from Brevo

`.catch(undefined)` on an env var does **not** disable a malformed value.
Reproduced against this repo's own `@nestjs/config`:

```
schema says        EMAIL_FROM_ADDRESS = undefined
ConfigService gives EMAIL_FROM_ADDRESS = "Kudos Cards <hello@kudos-cards.co.uk>"
```

`ConfigService.get()` reads the validated object first and `process.env`
second, so a rejected value is not unset — it is simply unvalidated. The raw
string goes to Brevo as the sender, Brevo rejects the request with a 400, and
**nothing appears in Brevo's dashboard**, because the send was never accepted.
Every HTML-fallback email — password reset, operator invite, team invite —
fails that way while the provider reports itself configured. The same applies to
`SUPPORT_INBOX_EMAIL` and every `BREVO_*_TEMPLATE_ID` (`"none"` is sent as a
template id).

`validateEnv` now removes rejected keys from the environment, so "degrades to
unset" is a fact rather than a promise. It touches only keys this schema
declares, and only ones it rejected.

### URLs, once

`httpUrl` strips trailing slashes. Every caller interpolates a path onto
`WEB_APP_URL`, so a trailing slash pasted into the dashboard produces
`https://…//reset-password` — and that doubled URL is what GoTrue validates
against the Redirect URLs allow-list. It does not match, `generateLink` throws,
the throw is swallowed, and the endpoint still answers 200 "check your email".
Four other modules already defended against this one at a time; the email
surface did not, and there it is fatal rather than cosmetic.

### Refusing rather than failing

A non-template send with no configured sender is refused in the client with a
clear message, instead of being posted to Brevo for a 400 that never reaches
anyone's dashboard. The password reset, both invites and the RTS notice are
HTML-only by construction, so the provider's "fine if every email uses a
template" reasoning never covered them.

Every fallback send now also carries a **text/plain part**. Brevo does not
synthesise one, and a single-part HTML-only message with a remote image and a
long tokenised link is the shape filters score down — which matters most for
exactly the emails people report as never arriving.

### Making the flow say what it did

`PasswordResetService` had three outcomes and two were silent: the no-account
path returned with no log at all, and a successful send logged nothing. An
operator asked "did we send it?" had no way to tell those apart, or from the
route never being reached. Three outcomes, three log lines. `NoopEmailClient`
logs at **warn**, not info, because every send through it is a customer waiting
for something that will never arrive.

### Two correctness bugs found on the way

- **The notification ledger was a race.** `notifyAccount` deduped with a read
  followed by a write and no unique constraint, so two producers both passed the
  check and both inserted — and the boolean that auto-send uses as "have we
  already told them" said "new" twice, sending the same email twice. There is
  now a unique index on `(accountId, userId, kind, entityId)` and the write uses
  `skipDuplicates`, so the answer is atomic. Existing duplicates are collapsed
  in the migration, keeping the earliest.
- **The account email fell to an arbitrary member.** `resolveAccountEmail`'s
  fallback took `members[0]` from an unordered `findMany`, so which colleague
  receives a service email could change after any update or vacuum — today's
  returned-card notice to one person, next week's support reply to another.

## Consequences

- One migration, additive, with existing duplicates collapsed first.
- `isPublicPath` moved to `lib/supabase/public-paths.ts` and is now tested.
- Nothing here proves which of these bit the reported customer — several would
  produce exactly his symptoms, and the environment was checked and healthy. The
  new logging is what will answer it next time, in seconds.
- Left deliberately alone: `generateAuthLink` still sends `redirectTo` to
  GoTrue even though every caller discards the action link and builds its own
  URL. Dropping it would remove a real coupling to the Redirect URLs allow-list,
  but it changes auth behaviour in a way this repo cannot verify against the
  live project's configuration. It belongs to its own change, with someone
  watching the dashboard.
