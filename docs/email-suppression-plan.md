# When Brevo stops delivering to an address

Brevo keeps a blocklist. An address lands on it after a hard bounce, a spam
complaint or an unsubscribe, and from then on Brevo **accepts our API call and
drops the message**. The send returns 2xx, nothing appears in the delivery log,
and nothing arrives.

Five addresses are on ours today. Three are invalid addresses (scoped to
**All** senders), one is a spam complaint and one an unsubscribe (both scoped to
**`Noreply@kudoscards.co.uk`**).

Nothing in the product knows about any of it.

## What is actually wrong

1. **We cannot see it.** There is no Brevo webhook. A blocked address is
   indistinguishable from a delivered one at every point we can observe, which
   is why a customer reporting a missing email sent us round four healthy-looking
   dashboards.
2. **One sender carries everything.** The app's transactional mail and — per the
   Supabase SMTP settings — every auth email both send as
   `noreply@kudoscards.co.uk`. Unsubscribes and spam complaints are scoped to a
   sender; hard bounces are account-wide. So somebody unsubscribing from one
   marketing send can suppress their own password reset, which they never agreed
   to and would never guess.
3. **We promise anyway.** Every one of these paths tells the customer "check your
   email" without knowing whether the address is deliverable.

## Phases

### E1 — Record what Brevo tells us — **done**

A `POST /webhooks/brevo` endpoint and an `EmailSuppression` table: one row per
address, carrying the reason, Brevo's own wording, the message id and when we
first and last saw it.

Two things this has to get right:

- **Authentication.** Brevo does not sign its webhooks — there is no HMAC
  header to verify, unlike Stripe. So the endpoint carries a shared secret
  (`BREVO_WEBHOOK_SECRET`) compared in constant time, exactly as the catalog
  revalidate route already does. No secret configured ⇒ the route refuses
  plainly rather than accepting anonymous writes.
- **The event vocabulary.** Brevo's _subscription_ API takes camelCase
  (`hardBounce`), while the _delivered payload_ carries snake_case
  (`"event": "hard_bounce"`). Rather than bet on one, the handler normalises the
  string — lowercased, separators stripped — and matches a known set. Anything
  unrecognised is logged and ignored rather than dropped silently, so a
  vocabulary change shows up as a log line instead of a gap.

Only suppressing events are stored. Opens and clicks are neither useful here nor
something to keep.

### E2 — Use it where somebody is waiting — **done**

- **Every send** is checked, by wrapping the configured email client rather than
  touching fourteen callers, so the log distinguishes "sent" from "sent into a
  wall". The send still goes out: Brevo drops it either way, and the attempt is
  what makes Brevo emit the event that keeps our record current.
- **Ops** see it on the subscriber page — the reason, the date and Brevo's own
  wording — so support can answer "why didn't he get it?" in one look. It says
  so when there is nothing to report, too.
- **The customer is told nothing new.** ADR 0051 keeps account existence
  undiscoverable, so "we can't email that address" on a public form would leak
  exactly what that protects. Telling somebody their own address is unreachable,
  once signed in, is reasonable and needs its own design.

### E3 — Stop one unsubscribe taking out a password reset — **done (inert)**

An optional `EMAIL_ACCOUNT_FROM_ADDRESS`, used for password resets and both
invite flows. Unset ⇒ everything behaves as it does now, so this has shipped
dark and turns on when a second sender is verified in Brevo.

The matching dashboard steps — verify the sender, set the variable, then point
Supabase's custom SMTP at it — are ops work and are written up in
`docs/ops/email-blocklist.md` rather than coded. See ADR 0269.

### E4 — The runbook — **done** (`docs/ops/email-blocklist.md`)

What each blocklist reason means and what to do about it: when unblocking is
right (a corrected typo), when it is actively harmful (re-sending to a dead
mailbox damages sender reputation), and when it needs the customer's say-so (a
spam complaint).

## What this deliberately does not do

- **Auto-unblock.** Removing an address from Brevo's blocklist because we would
  like to mail it is how a sender reputation is spent.
- **Retry a suppressed send.** A blocked address is blocked; sending again is
  the definition of the problem.
- **Suppress on a soft bounce.** A full mailbox or a momentary outage is not a
  dead address, and treating it as one loses real mail.
