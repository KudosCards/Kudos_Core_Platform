# 0221 — A cohort card is not the birthday realign's to delete

## Status

Accepted — implemented. From the follow-up review's N1, though not where N1
pointed. See "Where the review had it" below.

## Context

`realignBirthdayOccasion` keeps one birthday row per contact on the right date.
It reads every birthday row they have, ranks the live ones, moves the winner to
the corrected date and discards the rest — future losers deleted, past ones
retired as `missed`.

It read them like this:

```ts
const all = await prisma.occasion.findMany({
  where: { recipientId, accountId, type: "birthday" },
});
const live = all.filter((o) => isLive(o.status));
```

No `source`. Yet the create at the bottom of the same function has always
tagged its own row `source: "recurring_per_recipient"`. The writes were
labelled; the reads never asked.

**A shared event of type `birthday` writes a birthday row against the same
contact.** `birthday` is in the event type picker, so "September birthdays" — a
cohort card the whole class gets — is an ordinary thing for a customer to
create. `EventsService.create` stores it as `source: "shared_event"`, on the
event's date rather than the contact's.

So `live` held two rows that look identical to this function: the contact's own
birthday and the cohort card. The one on the corrected date won the ranking. The
cohort card became a loser and was **hard-deleted**, along with the design
chosen for it, while `LIVE_ORDER` includes `approved` — so an approved,
paid-for card went too.

**It needed no unusual sequence.** The contact page sends `dateOfBirth` on every
save (the finding 21 fix), so `dto.dateOfBirth !== undefined` is true on an
address-only edit and the realign runs anyway. Correcting a postcode destroyed
the cohort card. Clearing a date of birth was worse: that branch discards _every_
live row, so the cohort card went with the birthday that no longer existed.

Nobody found out until the day the card did not arrive. The audit entry says the
contact was updated.

## Decision

Only rows this function owns are candidates to move or discard:

```ts
const live = all.filter((o) => isLive(o.status) && isRolling(o.source));
const liveIds = new Set(live.map((o) => o.id));
```

**The read stays unfiltered, deliberately**, and this is the part a one-line
`where` clause would have got wrong. The unique key is
`@@unique([recipientId, type, occasionDate])` — **no source column**. A cohort
card on the corrected date genuinely occupies it. Filtering it out of the read
would make it an invisible blocker, and moving the keeper onto that date would
raise the P2002 that ADR 0185 exists to have removed.

So the blocker test is rephrased from "not live" to "not one of the rows I may
move":

```ts
const blocker = all.find((o) => o.occasionDate.getTime() === targetTime && !liveIds.has(o.id));
```

A cohort card on the target date now blocks, the contact's own row gives way,
and both survive — which is the correct outcome: the date _is_ represented, by a
card the customer already approved.

## Consequences

- A cohort card survives any edit to a member's contact record, including
  clearing their date of birth.
- The realign still does its job: a surplus recurring row on the wrong date is
  still discarded, and the on-target blocker path still avoids the P2002.
- Three mutations, each caught: reverting the source filter, reverting the
  blocker to the status-only test, and treating every source as rolling.

The unit spec's stub rows carried no `source`, so with the filter in place they
described no row the function acts on and two race tests stopped exercising the
write at all. The stub now carries the column the real row has. A stub that has
drifted from the shape it stands in for does not fail — it quietly stops
testing, which is why the mutation run matters more than the green tick.

## Where the review had it

The follow-up review filed this as N1 against `upsertKeyDate` and
`deleteKeyDate`, with a shared event of type `anniversary`. Those two functions
do have the same hole, and it is fixed in the same family of work — but the
scenario as written **cannot happen through the product**: neither `anniversary`
nor `renewal` appears in the shared-event picker (`OCCASION_TYPES`) or the
one-off contact-event picker (`EVENT_TYPES`), so nothing but the key-date path
itself creates those types, and it tags them `recurring_per_recipient`. Both
DTOs accept the full `OccasionType` enum, so a direct API call reaches it and
adding "Anniversary" to either dropdown would arm it — latent, worth closing,
not live.

`birthday` **is** in the shared-event picker. The reachable instance was one
model over from where the review pointed, in the function the review had
otherwise passed as fixed.

The review's own closing note names the habit: _the fix was applied where the
finding pointed, and the same defect survives one call site over._ That applies
to reading a review as much as to writing one.
