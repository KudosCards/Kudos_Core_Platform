# A card that posts to an address we know came back

A card returned in October flags the contact. That flag pauses their automatic
sends. It does **not** stop the card already paid for, already in the queue, and
already addressed to the same place — which prints in December and posts to the
address Royal Mail just handed back.

## This is a gap, not a new feature

ADR 0039 records what was agreed:

> **Flagged contacts:** automatic/**scheduled** sends pause hard until the case is
> resolved; manual checkout warns but is not blocked.

The only thing that ADR defers is hard-blocking _manual checkout_. A paid,
occasion-dated card posting in December is a scheduled send by any reading, and
it does not pause.

## What the recon found

- **`addressVerificationRequired` is enforced in exactly one place** —
  `auto-send.service.ts:143`, whose own comment states the intent: _"so we don't
  fire another card at a known-bad address."_ Reference count in the fulfilment
  service, the Click & Drop service, the dispatch-reminder service and the
  print-PDF service: **0, 0, 0, 0**.
- **Flagging touches nothing else.** `markReturned` moves that one job and line
  to `returned_to_sender`, sets the flag and opens the case. Sibling open jobs
  for the same contact are untouched.
- **Ops cannot see it.** Neither `QUEUE_SELECT` nor `MUST_SHIP_SELECT` carries
  the flag, so the queue row, the must-ship band, the shell banner and the daily
  reminder email all present the card as ordinary work — and the reminder
  actively chases an operator to post it.
- **An order line's address is write-once.** Every write of
  `shippingAddressLine1` in the API is a create; RTS recovery makes a _new_ order
  and line rather than editing one. No ops path edits a paid card's address.

## Decisions

**D1 — Hold on the address, not on the flag.** `archive()` can be called straight
from `awaiting_address`, before any correction, and it clears the flag. A
flag-keyed hold would therefore release the December card to the very address
that failed the moment a customer archived the case. The durable fact is the
address: a card is held when **its own posting address matches the address of a
card that came back for that same contact**. Archiving cannot make that untrue.

**D2 — A held card is derived, not a status.** The hold is a property of the
address and it resolves itself when the card is re-pointed. A new
`FulfillmentJobStatus` would need a migration, would touch the tabs, counts,
transitions, reminders and dashboard, and could drift out of step with the
underlying fact. `workingDaysUntilDue` is already computed rather than stored,
for the same reason.

**D3 — Refuse and name, do not silently exclude.** An operator selecting 40 cards
for a print run gets a refusal that names the held ones, not a sheet that quietly
prints 39. The same posture `assertDesignPrintable` already takes.

**D4 — Holding is not enough on its own.** When the customer corrects the
address, `updateAddress` writes it to the **recipient**. The queued card still
carries the old address on its own line, so releasing it unchanged would post to
the same place. Phase 3 is what makes the hold worth having.

**D5 — Re-pointing is explicit, never automatic.** Quick send deliberately lets a
sender edit the address for one order without mutating the stored contact, so an
order line's address is not always "the contact's address". Copying a corrected
address over queued lines silently would be wrong in exactly that case.

**D6 — Same contact only.** A card to a _different_ contact at the same address is
not held. A pupil moving away from a household where the family stays is the
common case, and holding the sibling's card would be a false positive with no way
for anyone to understand it.

## Phases

Each phase is its own PR, merged when green before the next starts. Phases 1–3
have landed; phase 4 is outstanding.

### Phase 1 — Stop the card

- The server refuses the address export, the print sheet, and the move to
  `printed`/`posted` for a held card, naming it.
- The Click & Drop sweep skips held cards rather than handing Royal Mail an
  order we will not post.
- `mustShip` excludes them, so the banner, the dashboard band and the daily
  reminder stop chasing an operator to post something that must not go.

**Falsifying check**: a card for the same contact carrying a _different_ address
must not be held, and a card whose contact has no return at all must be
untouched. A hold that fires on ordinary work is one an operator learns to work
around.

### Phase 2 — Show it

- The queue row carries the hold, with a filter and a count, so a held card is
  visible rather than silently missing from the work.

### Phase 3 — Fix it once

- When the customer updates the address on the RTS link, tell them how many other
  cards are waiting for that contact and offer to apply the corrected address to
  them — audited, never silent.
- Available on both recovery surfaces: the in-app contact panel and the
  no-login email link, which share the service method rather than duplicating
  the rule.

**Re-pointing releases the hold by itself.** The line no longer matches an address
anything came back from, so the print run simply stops refusing it. Nothing has
to remember to unlock anything, which is the payoff for keying the hold on the
address in D1.

**Royal Mail has to be told again.** A Click & Drop order cannot be edited, so a
re-pointed card has its import id cleared and is picked up by the next sweep —
with the new address — and the stale order is cancelled. Anything that will not
cancel is recorded rather than assumed gone, the same rule `cancelImported`
already applies to refunds: an uncancelled order is a duplicate card somebody has
to pull by hand.

**Refused until the address is actually corrected**, and with the specific
sentence rather than the generic status one: "update the address first" tells the
customer what to do, where "this return is awaiting_address" only tells them what
they just clicked.

### Phase 4 — Correct the record

- `mustShip` and the `FulfillmentCounts` doc both still describe the due buckets
  as pending-only. `counts()` contradicts them in its own comment and spans every
  open status.
- `DUE_FILTERS`, `QUEUE_SORTS` and `FulfillmentCounts` each exist twice — once in
  `shared-types` and once in the API (the query DTO and the service). Noticed
  while adding the held filter to all three, and left alone rather than widening
  phase 2; it is the same duplication #455 removed from the print rules.

## What this does not fix

A card already posted to a bad address. This work is entirely about the ones
still in the building.
