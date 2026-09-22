# 0257 — Approving without being asked

## Status

Accepted

## Context

Phase C6 of `docs/click-and-forget-plan.md`, and the gap the whole feature
exists to close.

`auto-send.service.ts` calls itself the hands-off half of "approve once, we
handle the rest", and that is accurate except for the word _once_: `runDue`
only ever looks at occasions already `status: "approved"`, and nothing in the
codebase sets that status without a person. So the honest promise was "approve
each card in one click", where the customer asked for "approve once, ever".

ADR 0256 built the standing instruction and the permission behind it, and left
it inert. This is what reads it.

## Decision

A cron at **06:30**, between the 06:00 scheduler that promotes birthdays into
the approvals queue and the 07:00 auto-send that acts on approvals. That
ordering is the design: this service only ever moves a card from "waiting for a
person" to "waiting for auto-send", and every guard downstream still applies
unchanged. It creates nothing, charges nothing and posts nothing.

### One definition of "running"

The blockers that decide whether an instruction runs now live in one pure
function, called by both the customer-facing view and this cron. Two
definitions would drift, and the drift would show up as a card that went when
the dashboard said it would not, or did not go when it said it would.

The state is re-read every morning rather than trusted from the `enabled` flag:
a plan can lapse, a list can be deleted and a design can be archived between one
run and the next.

### Smart lists are refused, not half-handled

A standing order may point at everybody, a hand-picked list, or a smart list.
The third does not run, and reports `audience_unsupported`.

A smart list is a rule, and an occasion-mode one ("Birthdays this month")
carries a rolling date window — so its membership moves on its own. Approving
cards for whoever a rule happened to match this morning is not a decision
anybody made, and the failure mode is a wallet emptied overnight on cards nobody
chose. Refusing visibly is the only version of this that is honest; supporting
it is a separate decision about what a smart-list audience even means.

### Bounded four ways

- **Birthdays only.** The answer to "what does it cover" was deliberately the
  simplest one.
- **Rolling per-recipient occasions only.** `type` does not say who wrote a row:
  a shared event writes birthday-type occasions for a whole cohort, and a bulk
  send writes one-off campaign rows. Neither is this instruction's to approve —
  somebody set those up and is waiting to approve them with the design they
  chose. The repository's own `occasion-reads-are-scoped` guard caught this
  before CI did, which is exactly what it exists for (ADR 0221, 0222).
- **`pending_approval` only.** Never `scheduled`: those are outside the
  approvals window, and promoting them early would post cards weeks before they
  are due. The 06:00 scheduler owns that promotion.
- **Inside the audience, and active contacts only.**

The write is `updateMany` guarded on `status: "pending_approval"`, which is the
same condition the query applied. The two are not redundant in the way they
look — the query makes the run cheap, the guard makes it correct when a person
approves, skips or cancels in the seconds between the read and the write. Each
still holds with the other removed, so the code says so rather than leaving a
reader to find out by deleting one.

### A missing address is approved anyway

This is the one place C6 deliberately diverges from `OccasionsService.approve`,
which refuses to set up an auto-send for a contact with no postal address.

That refusal is right when a human is there: they can fix it on the spot. Here
nobody is, and refusing would mean the card silently never happens — the exact
failure ADR 0254 was built to eliminate. So the intent is accepted, and
auto-send's existing gate stops the card and tells the customer why. The card
then goes the moment an address is added, with no further action.

### The design pick is a placeholder with its eyes open

Approving requires a design, and choosing one by what suits the recipient is C5
— which is blocked on the catalog having any attribute that describes a design
at all (C3). Until then the honest version of "pick a card" is "pick one of the
ones they chose", and only two properties matter: everybody must not get design
#1, and nobody should get the same card two years running. A hash of
`(recipientId, year)` gives both, deterministically — so a retried run cannot
silently change what somebody is sent, and a test can assert a card rather than
a distribution.

The seed is deliberately coarse. A birthday that shifts by a day — a leap year,
a corrected date of birth — must not change the card.

## Consequences

- "Approve once, ever" is true for the first time, for accounts that set up a
  standing order and agreed to the wording.
- Nothing about auto-send changed. Every stop condition it has always had still
  stops the card, and since ADR 0254 still says so.
- The message pool that ADR 0256 records is **still unused**. C6 approves with a
  design; applying a chosen message is C5, and the dashboard (C7) must not
  promise otherwise until it does.
- An approval is audited as `system:standing-order`, so the trail says plainly
  that no person approved this card.
