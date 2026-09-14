# 0242 — A card must print what was bought

## Status

Accepted — implemented in four phases (#429, #430, #431, and this one).

## Context

Reported from production: an account's seven single-card orders rendered each
other's messages in the ops print view. One card headed for Cole carried a
message to Alex; another carried two messages overlapping.

`OrderRecipient` is the row that **is** one card. It already froze where the
card goes and what it cost, and left what it says as a foreign key:

| frozen on the order line                       | read live at print time                      |
| ---------------------------------------------- | -------------------------------------------- |
| `shippingAddressLine1/2/City/Postcode/Country` | `savedDesign.document` — artwork and message |
| `dispatchOption`, `postageClass`               | `recipient.firstName` / `lastName`           |
| `priceMinor`, `postageMinor`                   | `recipient.customFields`                     |
|                                                | `occasion.type` / `title` / `occasionDate`   |

A saved design is a reusable template an account edits between sends.
`SavedDesignsService.update()` overwrote its document with no check for whether
any order referenced it, and `fulfillment.service.ts` handed whatever it said
_now_ to the print run. So an account reusing one design per send silently
rewrote every earlier order that had used it.

**Reproduced before anything was changed**, and the reproduction is the
regression test:

| action after a paid order   | expected      | actual           |
| --------------------------- | ------------- | ---------------- |
| edit the design's message   | `"To Elise…"` | `"To Florence…"` |
| duplicate the text box (⌘D) | one message   | two, overlapping |

Those are the two screenshots exactly. The overlap is the editor's own
**Duplicate**, which offsets a copy "so both are visible".

ADR 0158 reasoned about the neighbouring half and got deletion right: a design
an order references cannot be hard-deleted, because that would "break that
immutable history". The history was never immutable — only undeletable.

## Decision

The card carries its own copy of the artwork, taken when it was bought, and
everything renders from that.

**At row creation, not at payment.** Three sites create a card, and they are the
only ones; a rule attached to them cannot be missed. "Freeze when it leaves
draft" is not a one-way door — an expired Stripe checkout puts an order **back**
to draft, and payment arrives through four paths. And a draft is the cart:
showing a preview that can change after the customer looks at it is the same
defect one step earlier.

**Required with no default**, so each creation site has to say what it is
printing and a fourth fails to compile. The three answer differently on purpose:
checkout reuses the read it was already doing for the printability check, in the
same transaction that consumes the occasions; auto-send uses the design it
already loads; and a returned card's reprint copies the **original line**, not
the design — a return takes weeks, and recovering one is precisely when you want
the same card again.

**The migration is a stop, not a repair.** There is no record of what a design
used to say — `SavedDesign` has no version history and the service is
deliberately not audit-logged — so a card whose design had already moved on kept
today's content. `SET NOT NULL` is what proves the backfill reached every row: it
aborts rather than leaving a blank card behind.

**Ops keeps a way to correct a card.** This mattered more than it looked: the way
the reported orders were rescued was by editing the design, which is exactly what
this stops reaching a paid order. So the correction stays and is now deliberate —
one card, by a super admin, in the audit log, refused once the card is `printed`,
and serializable because the race it would lose is exactly the harm (an operator
re-syncing while another marks the card printed).

## What writing the guard found

The Phase 4 scan exists so a new report, preview or export cannot quietly reach
for the template again. Writing it turned up a defect the first three phases had
introduced.

The **storage reaper** deletes unreferenced objects, building its referenced-set
from `DesignAsset` urls and from every `CardDesign` and `SavedDesign` document.
That was complete while a card had no artwork of its own: anything a card could
print was reachable from its design. It silently stopped being complete. Remove
an image from the library, edit it out of the design, and its url survives in one
place only — the snapshot of a card already paid for. The reaper would have
proved it unreferenced and deleted the artwork out from under a card waiting to
print.

Fixed by walking `OrderRecipient.documentSnapshot` alongside the designs, with
both a unit test and an e2e that keep an object only a bought card references.

This is the second time in this session that a guard earned its keep by being
written rather than by firing later, and the shape is the one ADR 0238 named: a
conclusion that was true of the system as it stood, left in place while the
system moved.

## Consequences

- Four render and validate paths read the card, not the design. The artwork
  download needed no change because it reads through `printRun` — worth stating
  rather than leaving implicit, since that check decides whether an operator's
  click may fetch a url server-side.
- The files that may load a design's document are a curated list of four, each
  with a reason. The scan matches delimiters rather than patterns, because both
  forms nest, and it counts a Prisma read with **no** `select` — which returns
  every column, artwork included, and is the easiest way to read it by accident.
- The type system did not catch everything. The ops queue preview read
  `savedDesign.document` off a payload the web types itself, so it compiled
  cleanly and would have shown an operator a blank card. It was found by
  grepping for the field.
- Mutation-tested throughout, and two of those mutations are worth recording
  because they failed the _first_ time: one "restore" after a mutation was a
  `git checkout --` that discarded uncommitted work while printing success, and
  one mutation silently never applied. Both were caught by running the full suite
  rather than the targeted one.

## Still deferred

- **Recipient name, custom fields and occasion** are read live at print time too,
  so a renamed contact changes a paid card's `{firstName}`. Deferred with the
  tension named rather than hidden: the shipping address is _already_ frozen, so
  today a corrected contact reaches the card's text but not its envelope.
  Whichever way that is settled, it should be settled as one decision about a
  recipient. **The check that would falsify this deferral**: a card whose
  recipient was renamed, or whose custom fields changed, between order and print.
- **Repairing the already-corrupted orders** — impossible from our data. Ops
  corrected the reported ones by hand.
- **Design version history.** It would have made this recoverable rather than
  merely stoppable.
