# 0269 — One sender for getting back in

## Status

Accepted

## Context

Brevo scopes its blocklist differently depending on why an address is on it. A
hard bounce is account-wide: the mailbox does not exist, so no sender of ours
can reach it. An **unsubscribe or a spam complaint is scoped to the sender that
was used**.

Everything we send uses one sender. The app's transactional mail goes out as
`noreply@kudoscards.co.uk`, and Supabase's custom SMTP is configured with the
same address, so auth mail does too. Marketing and password resets are, as far
as Brevo is concerned, the same correspondent.

The consequence is not theoretical. Somebody who unsubscribes from a newsletter
has, without being told and without any way to see it, also switched off their
own password reset, their team invitation, and every other email that is the
only way back into their account. There is one of those on our blocklist today.

It is also the failure mode with the worst shape: the person most likely to
unsubscribe is the person least engaged, and the moment they come back — months
later, having forgotten their password — is exactly when the suppressed email
matters. They cannot get in, they cannot find out why, and nothing on our side
shows a problem.

## Decision

Mail somebody is locked out without goes out from a separate verified sender.

`SendEmailInput` gains `sender?: "default" | "account"`, and three sends set
`"account"`: the password reset, the team invitation and the operator-dashboard
invitation. Everything else is unchanged.

The line between the two is not "important" — every email thinks it is
important. It is **"is this the email somebody needs in order to get back in?"**
Those three are; a dispatch notice, a receipt and a low-balance warning are not,
and if a customer has unsubscribed from us they should stop arriving, which is
what an unsubscribe is for.

### It ships inert

`EMAIL_ACCOUNT_FROM_ADDRESS` is optional and unset by default. Until it holds a
sender that is **verified in Brevo**, `"account"` resolves to the ordinary
sender and every email behaves exactly as it does today. That is not caution for
its own sake: an unverified sender makes Brevo reject the entire request with a
400, which is how the HTML-fallback emails silently failed in ADR 0267. Falling
back is the only safe unconfigured behaviour, so the code and the dashboard can
be changed in either order.

`EMAIL_ACCOUNT_FROM_NAME` is optional separately, falling back to the ordinary
name, so the sender can be split without also having to decide on a display
name.

### What this does not fix

Supabase sends the signup-confirmation and change-email messages itself, through
custom SMTP, and picks its sender from its own dashboard rather than from
anything in this repository. Splitting that one is a Supabase settings change,
not a code change, and is written up in `docs/ops/email-blocklist.md` alongside
the Brevo half.

## Consequences

An unsubscribe or a spam complaint against our marketing sender stops being able
to lock somebody out of their account. It does not become reversible — Brevo's
existing blocklist entries stay where they are, scoped to the sender that was
used — so the five addresses already on it still need the runbook.

The three emails move to a different `From:`. Recipients who filtered on the old
address will need to notice the new one, which is the ordinary cost of the
split; auth mail is not the kind people filter away, and the alternative is the
failure above.

Two things have to happen in Brevo before any of it takes effect, and they are
ops work rather than a deploy: verify the new sender, then set
`EMAIL_ACCOUNT_FROM_ADDRESS`. Doing the second without the first is the one
sequence that breaks — which is why the code never uses an address it was not
explicitly given.
