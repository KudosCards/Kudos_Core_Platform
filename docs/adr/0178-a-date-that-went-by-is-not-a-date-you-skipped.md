# 0178 — A date that went by is not a date you skipped

## Status

Accepted — implemented. From a customer looking at their own contact and asking
why it had three birthdays.

## Context

A contact with a date of birth of 23 October carried three birthdays:

| Date            | Status shown                     |
| --------------- | -------------------------------- |
| 24 July 2026    | **Approved** (green)             |
| 9 August 2026   | Awaiting approval                |
| 25 August 2026  | "96" — Scheduled                 |
| 23 October 2026 | Birthday — Scheduled, in 8 weeks |

Only the last was right. The audit trail explained the rest exactly:

```
22 Jul 08:50  create        Recipient
27 Jul 14:54  approve       Occasion 84814e35  {savedDesignId: 0669…}
04 Aug 14:54  update        Recipient          ← date of birth edit #1
04 Aug 18:56  create_event  Occasion aee4534c  {type: leaver, title: "96"}
05 Aug 19:13  update        Recipient          ← edit #2
05 Aug 19:14  update        Recipient          ← edit #3
29 Aug 19:33  update        Recipient          ← edit #4
```

Four corrections to one date of birth. Five defects fell out of it.

### 1. Correcting a date of birth orphaned the old birthday

`update()` deleted only `scheduled` birthday occasions and created a new one.
Anything already promoted — in Approvals, or approved with a design chosen — was
left behind on the old date, permanently. Each correction therefore added a
birthday rather than moving one. Reproduced against a real database before any
fix was written:

```
add contact, birthday 5 days away   →  birthday 2026-09-03  pending_approval
approve it                          →  birthday 2026-09-03  approved
correct the DOB to 28 October       →  birthday 2026-09-03  approved   ← stale
                                       birthday 2026-10-28  scheduled  ← correct
```

### 2. An approved card that was never ordered never died

ADR 0174 swept past `pending_approval` rows out of the queue but deliberately
left `approved` alone, on the stated premise that _"an approved card is on its
way and a past date on it means the send is in flight"_. That premise is wrong,
and this contact disproves it: `approved` only means a design was chosen.
Nothing had checked it out. The 24 July card was approved on **27 July — three
days after the birthday had already passed** — and five weeks later it still
carried a green badge that the calendar renders as **"Ready to send"**.

The test asserting the old behaviour was written by us in #362 and encoded the
same wrong belief. It has been replaced.

### 3. A hand-added event was never retired either

`promoteDueOccasions` only promotes `birthday`, `renewal` and `anniversary`. A
leaver's date or a graduation is created `scheduled` and no timer ever touches
it, so its day passed and it sat "Scheduled" for ever with a live **Prepare
card** button. Pressing that button moved it into Approvals, where the next
nightly sweep immediately retired it — a round trip that looked like it had done
something and had not.

### 4. `skipped` was being used for things nobody chose

The sweep marked unactioned approvals `skipped`. A customer who never touched a
birthday was being told they had skipped it.

### 5. The same occasion was labelled differently on every screen

The "96" row is a `leaver` event the customer named "96".

|          | Contact page    | Approvals       | Calendar        |
| -------- | --------------- | --------------- | --------------- |
| Renders  | `title ?? type` | **`type` only** | `title ?? type` |
| That row | "96"            | "Leaver"        | "96"            |

Neither screen ever showed both, so the row was unreadable on all of them. And
two independent status tables disagreed on the words: the calendar called a
queued card "Card ordered" and a posted one "Card sent"; the contact page called
the same two "In fulfilment" and "Posted".

## Decision

**A new `missed` status, kept apart from `skipped`.** `skipped` is a person's
decision and carries an audit entry naming them. `missed` is a date that went by
with no card sent. ADR 0174 argued against a new enum value on the grounds that
two existing facts already distinguished the cases — true for the machine,
false for the reader, who is shown one word and told it was their choice.

Three populations become `missed`: past `pending_approval`, past `approved`, and
past `scheduled` **one-off** events. Recurring `scheduled` occasions are not
swept — the scheduler rolls a birthday forward to next year rather than leaving
last year's behind, so a past `scheduled` birthday is a transient state between
the date passing and the next nightly run, not a dead row. A card that is
`queued` or beyond is never touched: money is spent and it is part of an order's
history.

**A corrected date of birth moves the live birthday instead of orphaning it**
(`realign-birthday.util.ts`). The approval and the chosen design survive the
correction, because someone fixing a typo changed a date, not their mind about
the card. Where a contact already carries several live birthdays the
furthest-along one wins the date and the rest are retired, so existing damage
converges on a single correct birthday the first time the date is touched.

**`prepare()` refuses a date that has already passed**, with a reason that says
so rather than a generic conflict.

**One vocabulary.** `lib/occasions.ts` owns the labels, the tints and the
helpers; the contact page's private tables are gone. `occasionName` and
`occasionKind` give the name the customer typed _and_ what kind of date it is,
so the row reads "96 · Leaver" everywhere instead of half of that on each screen.

**Two smaller repairs.** The audit entry for a contact update recorded
`metadata: null`, so a trail could show that a date of birth had been edited
four times and not what any of the four values were — it now records the fields
changed and the date's before and after. And the square beside each approval row
showed the first three letters of the occasion type, so a queue of birthdays was
a column of identical "Bir"; it shows the contact's initials.

### Migration

Two migrations, because Postgres will not let a new enum value be used in the
transaction that created it. The second backfills all three populations, and
re-labels rows the old sweep had already marked `skipped`: a deliberate skip has
a `skip` audit entry against it, the sweep recorded none, so a past `skipped`
occasion with no such entry was never anyone's decision.

## Consequences

- A contact has one birthday, on the date their record says. Corrections move
  it; they no longer multiply it.
- A date that went by says so, on every screen, and says it in words that do not
  attribute it to the customer.
- Existing accounts are repaired by the backfill without anybody pressing
  anything. The contact this was reported from goes from four rows and three
  wrong ones to one upcoming birthday and three clearly-marked misses.
- `missed` is excluded automatically from the sendable and reconcilable status
  sets, which are allow-lists (`scheduled`, `pending_approval`, `approved`).
- The contact timeline folds past dates beyond the four most recent behind a
  "Show all" toggle: a contact accrues a birthday a year plus every one-off, and
  the history was burying the thing the section is for.
- Amends ADR 0174, whose approved-is-in-flight premise this replaces, and whose
  choice of `skipped` for the sweep is superseded by `missed`.
