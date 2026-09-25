# 0268 — When Brevo stops delivering

## Status

Accepted

## Context

ADR 0267 reviewed the whole email surface after a subscriber received neither a
password reset nor a signup confirmation, and found thirteen ways an email could
vanish without trace. The Brevo blocklist was checked by hand during that
investigation and looked ordinary. It was not ordinary — it was the answer.

Five addresses are on it. Three are invalid addresses, blocked account-wide; one
is a spam complaint and one an unsubscribe, both scoped to the sender
`noreply@kudoscards.co.uk`.

What a blocklist entry does is the part that matters. Brevo **accepts** the API
call for a blocked address, returns `2xx` with a message id, and drops the
message. It does not appear in the delivery log, because it was never sent. From
inside the product the send is indistinguishable from a successful one, and from
inside Brevo's dashboard there is nothing to see either — which is exactly why
four healthy-looking dashboards were reported during the last investigation.

Two structural problems sit behind it.

**One sender carries everything.** The app's transactional mail and — through
Supabase's custom SMTP — every auth email both send as
`noreply@kudoscards.co.uk`. Unsubscribes and spam complaints are scoped to a
sender; hard bounces are account-wide. So somebody unsubscribing from a marketing
send suppresses their own password reset, which they did not ask for and would
never guess. The unsubscribe on our blocklist today has exactly that effect.

**We promise regardless.** Every path that sends mail tells the customer "check
your email" without any idea whether the address is deliverable.

## Decision

Brevo already knows all of this and will tell us. It sends a webhook on every
bounce, block, complaint and unsubscribe. We were not listening.

### Record what Brevo tells us

`POST /webhooks/brevo` writes to a new `email_suppressions` table: one row per
address, holding the reason, Brevo's own wording, the message id, and when we
first and last heard about it. One row rather than a history — support needs
"can we reach this person now, and why not", and the history lives in Brevo.

Three decisions inside it are worth the ink.

**The endpoint authenticates with a shared secret, not a signature.** Stripe
signs its webhooks, so `/webhooks/stripe` can prove a request came from Stripe.
Brevo signs nothing: its transactional webhooks are plain POSTs with no HMAC and
no verifiable origin. The only thing available is a secret we choose and hand to
Brevo, compared in constant time — the same construction the catalog revalidate
route uses. It is accepted in a header or in the query string, because Brevo's
dashboard has not always allowed custom headers on a webhook; where the query
form is used the URL is itself a credential. Unset, the endpoint refuses
everything rather than letting anyone on the internet decide who we can email.

**Events are matched on letters alone.** Brevo spells the same event two ways
depending on where you meet it: the API that subscribes to events takes
camelCase (`hardBounce`), while the payload it delivers carries snake_case
(`"event": "hard_bounce"`). Nothing documents that split as stable, and guessing
wrong is silent — an unrecognised event is a suppression never recorded, the
precise failure this exists to end. So every event is reduced to letters before
matching, and `hard_bounce`, `hardBounce` and `HARD-BOUNCE` all land in the same
place.

**A delivery is the only evidence that clears a suppression.** Brevo will not
deliver to an address it blocks, so a `delivered` event is the authority's own
word that the block is gone — no human has to remember to tell us an address was
fixed. Both guards on that path lean one way on purpose: webhooks arrive out of
order, and an old delivery landing after a new bounce would declare a dead
address healthy, putting us straight back into silent failure. So a delivery
with no usable timestamp clears nothing, and a delivery older than the event
that suppressed the address clears nothing. Getting it wrong in the other
direction only leaves a stale row, which ops can clear by hand.

The comparison lives in the `where` clause rather than in a read followed by a
write, so two events racing cannot both pass a check only one should.

### What is deliberately not recorded, and not done

**Soft bounces and deferrals are ignored.** A full mailbox or a server having a
bad afternoon is not a dead address; suppressing on one loses mail that the next
attempt would have delivered.

**Opens and clicks are ignored.** Neither useful here nor something to keep.

**Nothing is unblocked automatically.** Removing an address from Brevo's
blocklist because we would like to mail it is how a sender reputation gets
spent, and re-sending to a mailbox that hard-bounced is the behaviour that puts
a domain in trouble in the first place. Unblocking stays a human decision, taken
in Brevo.

**No send is retried.** A blocked address is blocked. Sending again is the
problem, not the fix.

### Use it where somebody is waiting

Recording a fact nobody reads would be half a fix, so two surfaces read it.

**Every send passes a check.** The configured email client is wrapped rather
than replaced, so all fourteen callers are covered without any of them changing,
and a send to a blocked address is recognisable in the log instead of looking
like every other send. It still sends. Refusing would be the obvious move and it
is the wrong one: Brevo drops the message either way, and the attempt is what
makes Brevo emit the `blocked` event that keeps our record current — stop
sending and the record goes stale, which is this same failure arriving by a
different road. The lookup is also never allowed to fail a send; a database
hiccup must not cost the platform its email to gain a log line.

**Ops can see it against the account.** The subscriber page gains an "Email
delivery" panel naming every blocked address on the account — the billing
contact and every team member — with Brevo's reason, Brevo's own wording and the
date. It says so when there is nothing to report, too, because "we checked and
delivery is fine" is also an answer support needs to be able to give.

What the **customer** is told does not change. ADR 0051 keeps account existence
undiscoverable, and "we can't email that address" on a public form would leak
exactly what that decision protects. Telling somebody their own address is
unreachable, once they are signed in, is a reasonable thing to want and needs
its own design.

### Still to come

Splitting auth mail onto its own verified sender, so a marketing unsubscribe can
no longer take out a password reset, is the remaining half of the plan in
`docs/email-suppression-plan.md`. It needs a verified sender created in Brevo
first, so it ships behind an optional variable and stays inert until that
exists.

`docs/ops/email-blocklist.md` is the runbook: what each reason means, when
unblocking is right, and when it would be actively harmful.

## Consequences

An address Brevo refuses is now a fact the product holds rather than a silence.
"His password reset never arrived" becomes a row saying `hard_bounce — unknown
user`, dated, with the subject that triggered it, on the page an operator was
already looking at.

The cost is one indexed lookup per email sent, against an HTTP call to Brevo —
not a trade worth thinking about — and a second lookup when the subscriber page
is opened.

No customer-facing behaviour changes, and no send that used to go out stops
going out. The remaining exposure is the one this cannot fix from inside the
codebase: while every email shares a single sender, an unsubscribe from anything
suppresses everything, and the record will now show that happening.

`BREVO_WEBHOOK_SECRET` has to be set on the API and the webhook created in
Brevo's dashboard pointing at `/webhooks/brevo`. Until both are done the endpoint
refuses every request and bounces go unrecorded, exactly as they are today — the
failure mode is the status quo, not something worse.
