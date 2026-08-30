# 0191 — An occasion that has moved on must not be dragged back

## Status

Accepted — implemented. From an external code review (finding 15 of 37).

## Context

A bulk send can reuse a contact's natural occasion — the birthday the segment
matched — as the send record, rather than minting a superseding one-off. That
keeps the card's calendar event on the real birthday and avoids a duplicate
occasion (ADR 0119, ADR 0160).

To do it, `bulkSend` attaches the chosen design and moves the occasion to
`approved`, then hands the ids to `create()`, which consumes them
`approved → queued` under a status-guarded `updateMany` and aborts if the count
comes up short. That guard is sound. The write feeding it was not:

```ts
await this.prisma.occasion.updateMany({
  where: { id: { in: ids }, accountId },   // no status
  data: { ..., status: "approved" },
});
```

Every other write to an occasion in the file is status-guarded. One of them
even carries the rule in a comment — _"Status-guarded so an occasion that has
since moved on is never dragged back"_ — a few hundred lines below the write
that dragged them back.

Because it set `status: "approved"` unconditionally, it did not merely fail to
notice a concurrent change; it **undid** one. Two admins bulk-send to the
birthday segment at the same time. A consumes Beth's occasion
(`approved → queued`). B's write pulls it back to `approved`. B's own guard in
`create()` then passes, because B just made it pass. Two `OrderRecipient` rows
in two paid orders point at the same occasion, and Beth gets two identical
birthday cards.

The failing test written first pinned the interleaving — real code either side,
with only the concurrent write injected into the window — and reproduced it
exactly: **201 Created**, occasion resurrected, second order booked.

## Decision

The write is status-guarded like its siblings, and the counts are checked:

```ts
where: { id: { in: ids }, accountId, status: { in: [...RECONCILABLE_OCCASION_STATUSES] } }
```

If fewer rows were updated than there were reconciled recipients, the send is
refused with a `409` before any order exists.

Two decisions inside that are worth recording.

**The refusal names the contacts.** A count ("1 conflict") is useless in a
500-card send. Before throwing, the occasions still in a reconcilable status are
re-read; anything missing from that set was lost — whether it moved on or was
deleted — and its contact is named, the same choice the missing-address guard
already makes. The sender can deselect those people and send again.

**All the dispatch groups go in one transaction.** The occasions are written one
`updateMany` per distinct dispatch date, so without a transaction a refusal
would leave the groups written before the short one carrying the design — and,
worse, a `pending_approval` occasion silently moved to `approved` by a send that
never happened. That is a send the customer never authorised showing up as
ready to go. The transaction makes the refusal leave nothing behind.

Aborting the whole send rather than dropping the raced contacts is deliberate.
Dropping them silently sends to fewer people than the sender asked for; keeping
them as fresh bespoke occasions is the duplicate card this fix exists to prevent.
Refusing, naming who, and charging nothing is the only honest third option.

## Consequences

- The duplicate-card race is closed. The occasion stays with the order that
  claimed it first.
- A losing send now fails atomically: no order, no design attached, no occasion
  left approved. Previously a failure at this point left a half-applied send.
- Senders get a message that names people rather than a bare conflict.
- The window is genuinely narrow, so this will fire rarely — which is precisely
  why it needed a test rather than a watching eye.

Four mutations were run against the tests: removing the status guard (the
original bug), removing the count check, removing the transaction, and naming
every reconciled contact in the message instead of only the lost ones. Each was
caught.

## What this does not change

An admin who bulk-sends to someone whose occasion was already consumed — an
hour later, not concurrently — still gets a fresh one-off occasion and a second
card. That is not the same bug: a deliberate second send to a contact is a
legitimate thing to do, and the request carries nothing that distinguishes it
from an accidental repeat.
