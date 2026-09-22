# Click and forget

Scoping only — nothing built, and there are five questions at the end that
change the shape of it.

## What the feedback is asking for

> "We love the idea, the concept, however I may not have the time to keep on top
> of this. It would be great to just simply create the account, click / add the
> list of contacts and then forget about it — knowing Kudos will fulfil the
> orders."

You are right that this is essentially what Kudos does. The interesting part of
scoping it is therefore not "how would we build this" but **exactly where the
product stops and waits for a human today**, because that is the whole distance
between what we have and what that customer is asking for.

There are five such places. One of them is dangerous.

## What already exists

Most of the machinery, and it is good machinery:

|                       |                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| The automation itself | `AutoSendService.runDue`, a 7am cron: finds due occasions, creates the order, debits the wallet, queues fulfilment. No human step. |
| Money                 | The wallet and its ledger (ADR 0012), already the payment path auto-send uses.                                                     |
| The contacts          | `RecipientList` (manual membership) and `Segment` (smart lists — rule-based, so membership is dynamic).                            |
| The dates             | Birthday occasions are scheduled nightly from each contact's date of birth.                                                        |
| The plan gate         | `PlanEntitlement.autoSendEnabled` — false on Free, true on Pro, Centre and Enterprise.                                             |
| Telling people things | `NotificationInboxService`, plus the reminder emails in `RemindersService`.                                                        |

## Where it stops and waits

### 1. A human approves every single card

This is the gap. `auto-send.service.ts` describes itself as "the hands-off half
of _approve once, we handle the rest_" — and that is accurate, but the **once is
per occasion**. `runDue` only ever looks at occasions that are already
`status: "approved"`, and nothing in the codebase sets that status without a
person: every path runs through `OccasionsService.approve` or `approveMany`,
both behind an authenticated controller.

So today's honest promise is "approve each card in one click and we do the rest
of that card". The customer in that quote is asking for "approve once, ever".

### 2. There is no standing design

Approval requires a `savedDesignId`, and refuses without one — `autoSendOne`
throws "Occasion has no approved design". There is no default, per-account or
per-contact: I searched for one and there is nothing.

So even with standing approval, the system cannot answer the question _which
card do we send?_ without a human. **This is the first real design decision of
the feature, and it is not a technical one** — see the questions below.

### 3. A card that does not go out says nothing to anybody

`runDue` calls `notifyAccount` in exactly one place: `notifyAutoSent`, on
success. Every failure path writes an audit row and a server log line, and tells
the customer nothing.

For today's product that is survivable, because a customer who approved a card
last week is still broadly watching. **For "click and forget" it is fatal**: the
entire premise is that they are not watching, and the one moment they need to
hear from us is the one moment nothing reaches them. A birthday that silently
did not happen is the worst outcome this product has.

### 4. Nothing watches the wallet

The model rests on "the subscriber tops the wallet up with enough annual funds".
There is no low-balance threshold, no warning, and no auto top-up anywhere in
the codebase — I searched. The first a customer learns that the money ran out is
that cards stopped, and per gap 3, they are not told that either.

### 5. Six ways one card can stop, each silent

From `autoSendOne`, in order: no recipient; the contact's address needs
re-verification after a returned card (ADR 0039); no approved design; a missing
postal address; the plan no longer permits auto-send; and insufficient wallet
funds. Each throws, each is audited, none is surfaced.

Note the second one is _correct behaviour we must keep_ — it exists so we do not
fire another card at an address a card has already come back from. Click and
forget must not quietly switch that off. It has to surface it instead.

## The naming problem

"Campaign" is already taken twice, and both are visible:

- **`WalletCampaign`** — the admin-run sign-up credit scheme. Customers see its
  effect in the wallet ledger, labelled "Free credit".
- **`bespoke_campaign`** — an occasion type. The bulk-send screen renders it to
  customers as "occasion".

A third meaning on the dashboard would be the third, and the first two are
already close enough to confuse. **"Click and forget" is a good customer-facing
name** — it is the customer's own words, which is usually the right sign. For
the code and the data model I would suggest **standing order**: British, instantly
understood by a business user, and it is literally what this is — an instruction
set once and funded from a balance. It collides with nothing.

## Questions, and why each one changes the build

**1. Which card goes out?**

The crux. Options, roughly in ascending order of effort and of quality:

- One standing design per list, used for every card.
- One per occasion type — a birthday design, a thank-you design.
- A small rotation, so the same contact does not get an identical card each year.

This is a product decision about what a "forget about it" customer would be
embarrassed to have sent. A six-year-old and a sixty-year-old receiving the same
design is the obvious risk; so is the same person receiving the same card three
years running.

**2. Which occasions are in scope — birthdays only, or key dates too?**

Birthdays are scheduled automatically from the contact's date of birth, so they
need nothing new. `RecipientKeyDate` (work anniversaries, renewals) is a
different and larger surface. Starting with birthdays only is defensible and
much smaller.

**3. When the wallet is empty, what should happen?**

Three genuinely different products:

- **Skip and tell them loudly.** Safest; the card is missed.
- **Send anyway and let the balance go negative.** We are now extending credit,
  which is a commercial and legal decision, not an engineering one.
- **Auto top-up from a stored card.** The best experience by far and the largest
  build: off-session payments, SCA/3DS exemptions and failure handling.

**4. What does "permission to bill before each order goes out" mean, exactly?**

Reading your description, I believe you mean _permission to debit the wallet
without approving each card_ — which is a consent and UI change, and small.

The other reading is _permission to charge their card each time_, which is
Stripe off-session payments, 3DS challenges that arrive when nobody is looking,
and a dunning flow. Materially different build, materially different promise. I
have assumed the first and would like that confirmed before anything is written.

**5. Is this a Pro feature, or a new tier?**

`autoSendEnabled` is already false on Free and true on Pro and above, so the
plumbing exists either way. Whether click-and-forget is simply _how Pro feels_,
or something sold separately, is a pricing decision that changes what the
dashboard should say.

## The shape it would take

Conditional on the answers above, and deliberately ordered so the promise is
never bigger than the product — the same sequencing rule the UK scope work
followed, and for the same reason.

- **C1 — Tell people when a card does not go.** Gap 3 and gap 5. Independently
  worth doing: it makes today's auto-send honest, and it is the thing that makes
  standing approval safe to offer at all. **Nothing else should ship first.**
- **C2 — Watch the wallet.** A balance threshold, a warning with enough notice
  to act, and a projection: "at your current rate this funds cards until March".
  A customer who is not watching needs the warning to arrive early, not on the
  day.
- **C3 — The standing instruction.** The data model: a list, a design rule, an
  occasion scope, on/off, and a record of who turned it on and when. Plus the
  consent it represents, captured explicitly rather than implied by a toggle.
- **C4 — Automatic approval, bounded.** Occasions in scope for an active
  standing order skip the approvals queue. Everything in gap 5 still stops the
  card — it just gets surfaced now rather than swallowed.
- **C5 — The dashboard.** The click, and the honest status afterwards: what is
  covered, what is funded, what needs attention. The screen a customer opens
  once a quarter to confirm they were right to stop worrying.
- **C6 — The messaging.** Only once C1–C5 are true.

## What I would not do

- **Silently send a card when something is wrong.** Every stop condition in gap
  5 exists for a reason; the returned-address hold especially.
- **Turn it on for existing accounts by default.** Standing permission to spend
  has to be given, not inherited.
- **Build it on the approvals queue.** A customer who never opens the dashboard
  gets no value from a queue, however good it is.

## What I need to find out before building

Beyond the five questions, one thing about the customers in that feedback: **is
the barrier the approving, or the choosing?** "I don't have time to keep on top
of this" could mean either, and the answer changes question 1 completely. If it
is the approving, one standing design is plenty. If it is the choosing, they
want us to pick well on their behalf, which is a different and more interesting
product.

That is worth asking two or three of them directly before we design around a
guess.
