# Click and forget

Scoping only — nothing built. The five questions this started with are
answered; three still-open ones are at the end.

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

### 3. A card that does not go out says nothing to anybody — **fixed, ADR 0254**

`runDue` called `notifyAccount` in exactly one place: `notifyAutoSent`, on
success. Every failure path wrote an audit row and a server log line, and told
the customer nothing. C1 closed this; the rest of this section is why it was
first in the queue.

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

## The answers, and what they cost

All five questions are answered. Three of the answers are cheaper than they
look, one is dearer, and one of them cannot be built at all today for a reason
that is nobody's fault.

### 1. A chosen set of cards, picked per recipient — **blocked on the catalog, not the code**

> They select all the cards they like, and the automation selects one based on
> the receiver's profile.

The matching needs two things: signals about the recipient, and attributes on
the cards to match them against. **We have some of the first and none of the
second.**

A recipient carries: first and last name, date of birth (with
`birthYearKnown`), email, address, `tags`, and `customFields`. There is **no
gender, no relationship, no interests** — and none of those should be invented,
because a customer who never told us cannot be asked to live with our guess.

A card design carries: `category`, `name`, `slug`, `sku`, `thumbnailUrl` and its
`document`. **Nothing describes who it suits.** There is no age band, no tone,
no "for a child" or "for a 60th". So "pick a card that fits this person" has
nothing to pick on, and the honest version of that sentence today is "pick one
of their chosen cards at random".

Two consequences worth naming plainly:

- **The catalog has to be described before any matching is possible.** An age
  band and a tone on each birthday design is a modest, one-time piece of ops
  work — and it lands on the same 217 designs that are about to be re-exported
  for `docs/ops/catalog-re-export.md`. Doing both in one pass is the difference
  between one trip through the catalog and two.
- **Age is unknown for exactly the contacts a CRM sync brings in.** `birthYearKnown`
  is false whenever the source gave a day and month and no year — which is every
  CleanCloud contact by design (ADR 0252), and any CRM whose birthday field has
  no year. For those contacts, age-based selection is not degraded, it is
  impossible. The rule has to have a defensible answer for "we do not know how
  old this person is", and that answer will be common.

**The strongest signal we actually have is the one the subscriber gives us:
`tags`.** "Staff", "under-12s", "VIP clients" are the subscriber's own words
about their own people, they already exist, and they are more reliable than
anything we could infer. I would build the rule on tags first, and treat age as
an optional refinement for contacts where we know it.

### 2. Birthdays only — **agreed, and it is already scheduled**

Birthday occasions are created nightly from each contact's date of birth, so
this phase needs nothing new for the "when". `RecipientKeyDate` stays out.

### 3. Auto top-up from a stored card, pause and email when there is none — **and we are further along than expected**

`Account.stripeCustomerId` exists, `StripeCustomerService.getOrCreate` manages
it, and subscriptions are created against that customer. So **a Pro subscriber
already has a card on file** — it is the card paying for Pro. We do not have to
ask them for one.

What is missing is the guarantee: nothing in the codebase sets or records a
`default_payment_method` for off-session use. So the build is a
`SetupIntent`-or-read-the-subscription step to establish a usable method, then
off-session charges. The codebase already knows this territory —
`subscriptions.service.ts` handles a customer who "abandoned an SCA/3DS
challenge" — and that is exactly the failure that must be handled here, because
a 3DS challenge on an automatic top-up arrives when nobody is looking.

The pause-and-email path is therefore not an edge case. It is the normal
outcome of a card expiring, and it will happen to every long-lived account
eventually.

### 4. What is the best outcome — **your answer to 3 settles this**

Question 4 asked what "permission to bill" means. Answer 3 decides it: we need a
stored card, so the off-session machinery is being built regardless.

Given that, the best outcome for the platform is **not** to add a second money
path. Keep the wallet as the single ledger every order is paid from — it already
is, for auto-send — and make auto top-up the thing that keeps it funded. One
concept for the customer ("your balance, and it refills itself"), one payment
path in the code, and every existing guarantee about wallet debits still holds.

Billing a card per order instead would mean two ways an order can be paid,
reconciled separately, failing differently. That is the version that looks
simpler in a diagram and is worse everywhere else.

### 5. Pro and above, visible on Free — **agreed, and the gate already exists**

`PlanEntitlement.autoSendEnabled` is false on Free and true on Pro, Centre and
Enterprise, and both `AutoSendService` and `OccasionsService` already check it.
Showing the feature on Free with an upgrade prompt is a UI decision with no new
plumbing.

## The AI messages, and the one distinction that matters

> Add AI into creating the personalised messages — allowing the subscriber to
> create multiple personalised messages that can be automated.

There is **no AI dependency in the codebase today**, so this is a new vendor, a
new cost and a new failure mode. All of that is manageable. One design decision
is not, and it is the difference between a good feature and an unrecoverable
one.

**AI helps the subscriber write a pool of messages, which they read and approve.
The automation then picks from that approved pool.** It does not generate a
message at send time.

A card is printed and posted. It cannot be recalled, edited or apologised for
before it arrives. A message generated at 7am by a model nobody read, printed at
9am and in the post by noon, is a class of mistake this platform has no way to
undo — and the whole point of the product is a card somebody is pleased to
receive. Generation at authoring time is reviewable; generation at send time is
not.

There is a second reason, and it is the one that makes this easy rather than a
compromise. **The messages do not need to contain anybody's personal data.**
They contain merge tokens — `{firstName}`, `{name}`, and any custom-field key —
which the existing machinery substitutes at print time (ADR 0031, ADR 0033). So
the prompt is "write me five warm birthday messages for my customers" and the
output is `"Happy birthday {firstName} — hope it is a good one."`

**No recipient's name, birthday or address ever leaves the platform.** For a
product whose B2B customers are the data controller for their own contacts, and
whose privacy policy already commits to sub-processor diligence, that turns a
difficult data-protection conversation into a short one.

## Reducing the barrier, since it is both

You said to assume the barrier is both the approving and the choosing. The two
have different answers:

- **The approving** is solved by the standing instruction (C3/C4 below) and by
  telling people when something stops (C1). That is the mechanical half.
- **The choosing** is solved by making the set-up have good defaults rather than
  an empty form. A subscriber who picks nothing should still end up with
  something sensible: every active birthday design in their chosen tags, and a
  starter set of messages they can accept or rewrite. **An empty state that
  demands twelve decisions is the barrier**, and it is the one we would be
  adding if we are not careful.

## Phases

Ordered so the promise is never bigger than the product.

- **C1 — Tell people when a card does not go. Built (ADR 0254).** Every skip a
  customer can act on now reaches them twice — the inbox and an email — naming
  the card, the reason and the fix. The reasons became codes rather than thrown
  message strings, the inbox dedupe doubles as the ledger so a daily retry is
  not a daily email, and a failure nobody can explain also raises a super-admin
  alert. This was the thing that had to ship before anything else: until it did,
  standing approval was a promise we could not keep.
- **C2 — Watch the wallet, then refill it.** The low-balance threshold and
  projection, then auto top-up off-session, then the pause-and-email path when
  there is no usable card. The order matters: the warning is useful on its own
  and must work even when top-up fails.
- **C3 — Describe the catalog.** Age band and tone on each birthday design,
  done in the same pass as the re-export. Ops work, not code, and it unblocks
  any selection rule better than random.
- **C4 — The standing instruction.** The model — a list, a chosen set of
  designs, a message pool, birthdays, on/off — plus the consent it represents,
  recorded explicitly with who turned it on and when.
- **C5 — Selection and messages.** The rule that picks a design and a message
  per card, and the AI-assisted authoring that fills the pool. Deliberately
  after C3, because before it there is nothing to select on.
- **C6 — Automatic approval, bounded.** Occasions in scope skip the approvals
  queue. Every existing stop condition still stops the card, now visibly.
- **C7 — The dashboard, and the Free-tier prompt.**
- **C8 — The messaging.** Only once C1–C7 are true.

## What I would still not do

- **Generate a message at send time.** See above.
- **Infer anything about a recipient we were not told.** Gender from a first
  name is the obvious temptation and it is wrong often enough to be memorable
  for the wrong reasons.
- **Send a card when a stop condition is live.** The returned-address hold
  especially — it exists so we do not fire a second card at an address the first
  one came back from.
- **Turn it on for existing accounts by default.** Standing permission to spend
  is given, not inherited.
- **Let the empty state be a wall of choices.** See the barrier note above.

## Still open

1. **What does the selection rule do when it knows nothing?** A contact with no
   tags and no birth year, which is the CleanCloud default. Random from the
   chosen set is defensible and should be stated rather than discovered.
2. **How many messages is a pool?** One is not personalisation; twenty is a
   chore. A starter set of five, editable, is a guess I would like to test
   rather than assume.
3. **Which AI vendor, and on what terms?** A data-processing agreement and a
   UK/EU processing region are the two things that matter, and they are a
   procurement question rather than an engineering one — made much easier by the
   fact that no personal data is in the prompt.
