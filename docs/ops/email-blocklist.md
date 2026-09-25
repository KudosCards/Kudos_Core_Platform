# Brevo's blocklist: what it means and what to do

An address on Brevo's blocklist is not "failing to send". Brevo **accepts** the
send, returns a message id, and drops the message. It never appears in the
delivery log, because it was never delivered — which is why a blocked address
looks identical to a healthy one from everywhere except this list.

Two places show it now:

- **Brevo → Contacts → Blocklist** — the source of truth, and the only place it
  can be changed.
- **Admin → Subscribers → _(a customer)_ → Email delivery** — the same
  information against the account it affects, which is the view that answers
  "why didn't he get it?".

## Setting the webhook up

Recording only works once both halves exist.

1. Set `BREVO_WEBHOOK_SECRET` on the API to a long random string.
2. In Brevo, create a **transactional webhook** pointing at
   `https://<api-host>/webhooks/brevo`, subscribed to **hard bounce, blocked,
   invalid, spam, unsubscribed** and **delivered**.
   - `delivered` is what lets a suppression clear itself: Brevo will not deliver
     to an address it blocks, so a delivery is proof the block is gone.
3. Give Brevo the secret. If the webhook form allows custom headers, add
   `x-brevo-webhook-secret: <the secret>`. If it does not, append
   `?secret=<the secret>` to the URL instead — and treat that URL as a
   credential, because that is what it now is.

Until both are done the endpoint refuses every request and bounces go
unrecorded, which is exactly where we were before. Nothing breaks; we simply
learn nothing.

## Splitting the sender (do this once)

Everything we send currently goes out as `noreply@kudoscards.co.uk` — the app's
mail and, through Supabase's custom SMTP, every auth email. Because Brevo scopes
unsubscribes and spam complaints **to a sender**, that means one unsubscribe
switches off that person's password reset too. Giving account mail its own
sender ends that.

Three steps, in this order. The middle one is the one that must not be skipped.

1. **Verify a second sender in Brevo** — Brevo → Senders → Add a sender, e.g.
   `security@kudoscards.co.uk`, and complete the verification email. Nothing
   below works until Brevo lists it as verified: an unverified sender makes
   Brevo reject the whole request with a 400, and the email never reaches the
   dashboard to be found later.
2. **Set `EMAIL_ACCOUNT_FROM_ADDRESS`** on the API to that address (and
   optionally `EMAIL_ACCOUNT_FROM_NAME`, e.g. "Kudos Cards Security"). Password
   resets, team invitations and operator invitations move to it immediately.
   Everything else stays on the ordinary sender, which is the point.
3. **Point Supabase at it too** — Supabase → Authentication → SMTP Settings →
   sender address. This covers the signup confirmation and change-email
   messages, which Supabase sends itself and which no code change can reach.

Until step 2 is done account mail keeps using the ordinary sender, so the code
and the dashboard can be changed in either order without anything breaking. See
ADR 0269.

## The reasons, and what each one asks of you

### Hard bounce — the mailbox does not exist

Usually a typo, a person who left an employer, or a domain that has gone. Brevo
blocks these **account-wide**, so no sender of ours can reach them.

**Do:** check the address with the customer. If it was wrong, get the right one
and change it in the app — a new address is not blocked, so nothing needs
unblocking. If it was right and the mailbox is genuinely gone, leave the block
in place.

**Don't:** unblock and re-send. Repeatedly mailing a dead mailbox is one of the
clearest signals a receiving provider uses to decide a sender is careless, and
it is paid for by everyone else's mail.

### Invalid — Brevo would not even try

The address is malformed or its domain has no mail server. Scoped to **all**
senders.

**Do:** treat it as a data-quality problem — the address is wrong, not the
person. Correct it with the customer.

### Blocked — already on the list when we tried

A record of us attempting a send to an address blocked for one of the other
reasons. Useful as confirmation that a specific email really was dropped; the
reason to act on is whichever one put the address on the list first.

### Spam complaint — the recipient pressed "this is spam"

Scoped to the **sender** that was used.

**Do:** leave it blocked. Someone who reported us does not want unblocking, and
overriding that is both rude and expensive: complaint rates are what providers
use to decide whether our mail reaches anyone's inbox. If the customer says they
did not mean it and wants our email again, they can say so in writing, and
**then** it can be reversed in Brevo.

**Don't:** reverse it because a colleague asked, or because the email was
"important". Importance is not consent.

### Unsubscribed — the recipient opted out

Scoped to the **sender** that was used, which is what the sender split above
exists to end. While everything shares one address, unsubscribing from one
newsletter silently suppresses that person's account emails too — their password
reset included. They never asked for that and cannot see it.

**Do:** if a customer cannot get a password reset and the blocklist shows an
unsubscribe, that is the cause. Ask whether they want our mail again; if they do,
remove the entry in Brevo with their say-so. Once the sender split above is
finished this stops happening to new unsubscribes, but existing entries stay
where they are — they are scoped to the sender that was used at the time.

**Don't:** remove it silently.

## After unblocking in Brevo

Our record clears itself the next time Brevo delivers to the address — no action
needed, and nothing to remember. If the customer says it is still showing as
blocked and no mail has been sent since, send them any account email (a password
reset is the easy one) and the delivery event will clear it.

## What the product will not do

- It will not unblock anything automatically.
- It will not retry a suppressed send.
- It will not suppress on a soft bounce, which is a full mailbox or a bad
  afternoon rather than a dead address.
