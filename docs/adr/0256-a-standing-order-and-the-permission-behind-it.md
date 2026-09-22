# 0256 — A standing order, and the permission behind it

## Status

Accepted

## Context

Phase C4 of `docs/click-and-forget-plan.md`: the model a subscriber sets up
once — which contacts, which cards, which messages — and the permission it
represents.

The gap it closes is the first one the scoping found. Auto-send describes itself
as the hands-off half of "approve once, we handle the rest", and that is
accurate except for the word _once_: `runDue` only ever looks at occasions
already `status: "approved"`, and nothing sets that status without a person. So
today's honest promise is "approve each card in one click", where the customer
asked for "approve once, ever".

This phase does **not** close it. It builds the instruction and the consent, and
nothing reads them yet: the rule that picks a design and a message is C5, and
automatic approval is C6. Keeping them apart is deliberate — a permission that
can be reviewed before anything acts on it is a far easier thing to get right
than one that arrives with the machine already running.

## Decision

### Called a standing order

"Campaign" is taken twice and both are visible to customers: `WalletCampaign`
(the admin sign-up credit scheme, which shows in the ledger as "Free credit")
and `bespoke_campaign` (an occasion type the bulk-send screen renders as
"occasion"). A third meaning on the dashboard would be the one too many.

"Click and forget" stays as the customer-facing name — it is the customer's own
words. In code and data it is a **standing order**: British, instantly
understood by a business user, and literally what this is.

### One per account

The whole value is that it is a single decision. A second instruction would
immediately raise "which one wins for a contact in both", which is a question
nobody wants to answer and the sort of thing that turns a simple feature into a
rules engine. Enforced by a unique index; loosening it later is additive.

### The consent is a record, not a flag

A standing order spends money from the wallet and prints things in somebody's
name without asking again. That is a permission, so it is stored as one: who
agreed, when, and **which words they were shown**.

The version is the part that matters. An `enabled` boolean can say they once
agreed to something; it cannot say whether they agreed to what the product does
today. So when the statement changes materially the version goes up, every
existing consent stops covering it, and the instruction is not active until
somebody reads the new wording and agrees. That is deliberately inconvenient and
it is the only version of this that stays honest.

Agreeing is also a separate act from switching on. A save that does not agree
leaves the record alone — including an out-of-date consent, which stays on the
record as the fact it is rather than being quietly upgraded or erased. Somebody
turning the feature back on months later does not thereby re-agree to wording
they have not seen.

### `enabled` and `active` are different things

"Off" is a choice somebody made. A **blocker** is the product declining to act
on a choice it can no longer honour, and the two must not be conflated: a
customer told "on" while nothing happens has been lied to, and this is the
feature where being lied to costs a birthday.

Four blockers, each reported: the plan no longer permits automatic sending,
nobody has agreed to the current wording, the pool has no designs or no
messages, and — the one worth the most care — the audience is gone.

### The audience gap, and the column that closes it

The foreign keys to the list and the segment are `ON DELETE SET NULL`, because
deleting a list must not silently delete the instruction and the recorded
consent with it.

But a null list id is indistinguishable from a deliberate "everybody", and
"everybody" is a legitimate and common setting. Without something to tell them
apart, deleting a list would silently widen a standing order from one class of
thirty children to every contact on the account — quietly, and spending the
wallet on it. So `audienceKind` records what was _meant_, beside the id that
says what it points at. A CHECK constraint makes the two agree on the way in;
they are allowed to disagree afterwards, and only in the one direction a SET
NULL can produce. That asymmetry is the whole mechanism.

### A pool membership is a reference

`SavedDesignsService.remove` hard-deletes a design when nothing references it
and archives it when something does (ADR 0158) — deciding which by whether
Postgres raises a foreign-key violation.

So the design pool's foreign key is `ON DELETE RESTRICT`, not `CASCADE`. A
cascade would answer "nothing references it" and quietly narrow a pool the
customer chose. Restricting makes the pool count as the reference it is: the
design is archived, the pool row survives, and the API reports which card can no
longer be sent. No change to the design service was needed — its existing
mechanism already encodes "this is part of something somebody depends on".

For the same reason, saving a pool that contains an archived design is
**refused** rather than silently filtered. Sending a pool and getting a
different pool back is how somebody ends up sending cards they did not choose.

### Free sees all of it

Reading and saving work on every plan; only switching it on is gated on
`PlanEntitlement.autoSendEnabled`. The upgrade prompt then lands on somebody who
has already chosen their cards and written their messages, rather than on an
empty page — which was the explicit instruction to reduce the barrier rather
than add one.

### Messages are text with merge tokens

A pool message is plain text containing tokens like `{firstName}` (ADR 0031,
0033), substituted at print time. So a message holds **no recipient's personal
data**, which is what will let a model help write them in C5 without anybody's
contacts leaving the platform.

`source` records whether the subscriber wrote a message or kept a drafted one.
Those are not the same promise, and a subscriber deserves to see which of their
messages are their own words.

The 500-character cap is derived rather than guessed: the seeded inside-right
message box wraps at 394 units on the 450 × 634 canvas, which at the content
pre-flight's own glyph-width factor is about 54 characters a line and about 27
lines of vertical room — roughly 1,400 characters. 500 is comfortably inside
that, so a message that passes validation cannot overflow a default card. It is
a sanity bound and not a fit guarantee; a moved or shrunken text box is
`card-content.ts`'s business at render, which is the only thing that can know.

## Consequences

- Every existing account gets no row at all, and reading never creates one. The
  product behaves exactly as it does today until somebody sets one up.
- Nothing sends anything yet. The instruction is inert until C5 and C6.
- A customer can lay the whole thing out on Free and see exactly what upgrading
  buys.
- The `standingOrderBlockerSchema` has no Prisma twin (it is derived on read),
  so it joins the named exemptions in `prisma-zod-enum-parity.spec.ts` rather
  than being silently unpaired.

## Still open

Where a pooled message actually goes on the card. `buildCardDocument` seeds the
inside-right text element with `id: "inside-message"`, but nothing reads that id
back and a customer can rename or delete it in the editor — so it is a
convention by accident, not a contract. C5 has to decide this properly rather
than guess, because guessing wrong prints the wrong thing on a card that cannot
be recalled.
