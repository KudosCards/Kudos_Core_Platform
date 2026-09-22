# 0255 — A wallet that watches itself

## Status

Accepted

## Context

The wallet (ADR 0012) is the single ledger every order is paid from, and
auto-send spends from it every morning. Nothing looked at the balance. There
was no low-balance threshold, no projection and no automatic top-up anywhere in
the codebase: the first a customer learned the money had run out was that cards
had stopped, and until ADR 0254 they were not told even that.

That is phase C2 of `docs/click-and-forget-plan.md`, and the plan was specific
about the order: the threshold and projection first, then the automatic top-up,
then the pause-and-email path — because **the warning is useful on its own and
must work even when the top-up fails**.

## Decision

A 9am cron, after the birthday scheduler (6am), auto-send (7am) and the
reminder digest (8am), so the balance it reads is the one the day has left.

### It projects, rather than thresholding

A low-balance threshold answers a question nobody asked. What a customer needs
to know is **which of the cards they have already approved will not go, and
when** — so the watch prices the account's committed cards in the order they go
out and walks the balance down them until it runs out. The message is "your
balance covers the next 6 of 9 cards; Grace's, on the 14th, is the first it will
not reach", which is a thing to act on rather than a number to interpret.

Only `approved` + `auto_send` occasions count. A card still in the approvals
queue needs a human before it can cost anything, and one already `queued` has
had its money taken — counting either would warn about a shortfall that does
not exist.

The horizon is 30 days, not the reminder email's 7 (ADR 0183). Seven days is
right for "act on this card now" and wrong for money: topping up is a decision
somebody has to make, birthdays arrive in clusters, and a month is how a
customer thinks about funding an account. There is deliberately **no lower
bound** on the dispatch date, the same argument `RemindersService` makes: a card
whose date has passed and which is still approved is one auto-send could not
send this morning, and a `gte: today` would drop exactly those.

### The top-up runs first, and is only a floor

Warning somebody their balance is short and then fixing it in the same run is a
warning about nothing, so the standing instruction runs before the projection.

But a top-up is a floor, not a promise to cover everything: an account that
adds £50 with £200 of cards due still needs telling. The two mechanisms are
kept separate and the warning is computed on the balance _after_ any top-up, so
both statements stay true.

### Billed through an invoice, not a bare PaymentIntent

ADR 0103 promised a VAT receipt for the money a wallet customer actually pays.
An automatic top-up is the same taxable purchase arriving by a different door,
so it goes through Stripe's invoice API — create, finalise, pay off-session —
and captures the receipt onto the ledger entry in the same create, exactly as
the manual path does.

Finalise-and-pay in the same run, rather than `auto_advance` plus a webhook,
because the cron has to know the outcome in time to decide whether to pause.
`pending_invoice_items_behavior: "exclude"` matters: without it any unrelated
pending invoice item on the customer would be swept onto the invoice and charged
as part of a "top-up" nobody asked for.

Past the point the invoice is paid, the money has moved. A credit that then
fails is **not** retried — retrying would charge them twice — so it raises a
super-admin alert naming the invoice, for an operator to credit by hand.

### The card is the one they already pay us with

A Pro subscriber already has a card on file: it is the card paying for Pro. The
watch prefers whatever Stripe already treats as the customer's default and
otherwise takes the most recently attached, dropping expired ones first —
"a stored card that is active" was the requirement, and charging a card that
cannot work turns a clear "add a card" into a confusing decline.

### A failure pauses, and pausing means pausing

A bank that declined us today will decline us tomorrow, and a failed charge a
day is how an account ends up locked by its own bank. So a failure switches the
instruction off, records why, and tells the customer. Nothing automatic turns it
back on — saving the form does, which is what somebody is there to do once they
have fixed the card.

The reasons are codes with copy, per ADR 0254, and the same rule applies to the
unexplained one: a failure that is not a card decline is told to the customer
_and_ raised with Kudos HQ, because "check your card" would waste their time and
hide ours.

### Permission is given, never inherited

`autoTopUpEnabled` defaults to false and every existing account starts switched
off. The bounds are set against the manual top-up's: an unattended charge must
never exceed what the same customer could authorise by hand, so
`AUTO_TOP_UP_AMOUNT_MAX_MINOR` is defined as `TOP_UP_MAX_MINOR` rather than
typed out again (ADR 0164).

## Consequences

- An account that stops watching gets told which card its balance will not
  reach, a month before it is due, and can have the wallet keep itself funded.
- One Stripe invoice per automatic top-up, with the VAT receipt ADR 0103
  promised. Four API calls where a PaymentIntent would have been one — the
  deliberate cost of not quietly dropping a receipt.
- Two new emails and two new inbox kinds. Neither is gated on
  `reminderEmailsEnabled`, for the reason `common/account-email.ts` states.
- `SAFE_ACCOUNT_SELECT` gained the five columns, so the settings ride on the
  account payload as well as `GET /wallet`. `SafeAccount` is
  Account-minus-the-claim-token, so a column left out of that select stops
  compiling rather than quietly disappearing.
- This is the first phase of click-and-forget that **removes** a way a card can
  stop rather than reporting it. Five remain.
