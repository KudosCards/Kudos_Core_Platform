# Why click and forget captured one student out of eight

## The report

Chris, 24 September 2026, on the Darlington Kip McGrath account:

> This student (Izobella Ross) is shown as auto-send for 8th Oct but looking at
> the calendar there are a number of other students which should be captured.

And separately, that Izobella's send day may not be right to get there in time.

Click and forget is switched on and reports **Running**, covering **148 of 148
contacts**. The calendar shows eight birthdays inside the next three weeks. One
of them is scheduled to send.

## What has to happen for a card to go out

Three crons, in order, each morning. Every one of them is invisible from the
calendar.

|       | Job                            | Moves                                       | Requires                                                                                            |
| ----- | ------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 06:00 | `promoteDueOccasions`          | `scheduled` → `pending_approval`            | type in (birthday, renewal, anniversary) · recipient `active` · date within 21 days                 |
| 06:30 | `StandingOrderApprovalService` | `pending_approval` → `approved` + auto-send | type `birthday` · source `recurring_per_recipient` · recipient `active` · in the instruction's list |
| 07:00 | auto-send                      | `approved` → ordered and posted             | `dispatchDate <= today`                                                                             |

The calendar, meanwhile, shows an occasion whenever its recipient is **not
archived** (`occasions.service.ts:399`). That is a far looser rule than any of
the three above, and the gap between them is the whole problem: a contact can
sit on the calendar in "Upcoming" yellow indefinitely while being ineligible at
gate 1, and nothing anywhere says so.

## What the screenshots establish

The Approvals page says **"Nothing waiting for approval right now"**. That is
the complete list of `pending_approval` occasions for the account — the page
and the badge query the same filter with no date bound.

So the eight upcoming birthdays are **not** `pending_approval`. They never got
through gate 1. Which leaves three candidate causes, and only data can separate
them:

1. **Their recipients are not `active`.** A `lapsed` contact is excluded by
   gates 1 and 2 but still drawn on the calendar. See the section below — this
   is the leading candidate, and it is a defect in its own right.
2. **Their occasions are not a promotable type.** Only birthday, renewal and
   anniversary are promoted on a timer.
3. **The 06:00 cron is not completing** for this account.

`docs/ops/diagnose-click-and-forget.sql` answers this. It reports, per contact,
which gate they are stuck at rather than that they are stuck.

## Confirmed defects

These are established from the code and do not depend on the diagnosis above.

### 1. `lapsed` is undefined behaviour that silently stops cards

`RecipientStatus` has three values. Two are meaningful. `lapsed`:

- is **never set** by anything in the API — no import, no sync, no cron
- has **no ADR** and no definition anywhere in the repository
- is **selectable** in the smart-list rule builder and **counted** on the ops
  subscriber page, so it looks supported
- is **excluded by both crons**, which take `status: "active"` exactly
- is **included by the calendar**, which excludes only `archived`

So a contact in this state appears entirely normal, shows their birthday on the
calendar as upcoming, and never receives a card. Nothing reports it.

This is the same disagreement ADR 0266 fixed between the approvals badge and the
approvals page, in a place that pass did not reach: there I made the _reads_
agree on "not archived" and left the two _writers_ on "active".

### 2. The approvals badge never refreshes after the queue is drained

`approvals-client.tsx` mutates its own state after an approve or a skip and
never calls `router.refresh()`. Nine other clients under `(app)/` do. The badge
lives in the shared layout, so it keeps whatever number it was rendered with
until a full page load.

That is exactly the screenshot: **badge 3, page empty**. The badge is not
counting something the page is hiding — it is remembering something the page
already dealt with.

### 3. A birthday created by hand can never be auto-sent

`POST /occasions` writes `source: "one_off_campaign"` regardless of the type
requested, and gate 2 requires `recurring_per_recipient`. A birthday added
through **+ New event** on the calendar is therefore permanently outside click
and forget — it will wait for a human every year, on an account whose whole
premise is that it has stopped asking.

It is also created as `pending_approval` immediately, with no date bound, so a
birthday eleven months out joins the approvals queue today and counts toward the
badge.

## Izobella's send date

Computed with the real function rather than by hand:

| Contact             | Birthday   | Posts          |
| ------------------- | ---------- | -------------- |
| Ryan Mafukidze      | Sat 3 Oct  | **Mon 28 Sep** |
| Katie Baker         | Mon 5 Oct  | **Mon 28 Sep** |
| Freddie Etherington | Thu 8 Oct  | Thu 1 Oct      |
| Blessing Mavindi    | Thu 8 Oct  | Thu 1 Oct      |
| Chloe Clark         | Fri 9 Oct  | Fri 2 Oct      |
| Hannah Kirby        | Mon 12 Oct | Mon 5 Oct      |
| Anna Scott Wailes   | Mon 12 Oct | Mon 5 Oct      |
| Izobella Ross       | Thu 15 Oct | Thu 8 Oct      |

Izobella's 8 October is **correct** — five working days before her birthday,
which is the send-by-5 rule in ADR 0115, applied exactly.

What the table shows instead is urgency. Two of the missing students had to be
posted on **28 September**, four days after Chris recorded this. Their cards are
now late or missed, and nothing will have told anyone.

There is a fair product question underneath Chris's remark, which is not a bug:
send-by-5 posts second class five working days ahead, so a card typically lands
two to three days **before** the birthday rather than on it. That is deliberate
— it is what stops anything arriving late — but "posts around 8 October" against
a 15 October birthday reads oddly on screen, and the calendar hides the posting
date behind a **Dispatch dates** checkbox that is off by default. An operator
reading the calendar cannot see when anything actually posts.

## What this points at

The individual defects are worth fixing, but they are symptoms. The pattern is
that **the calendar promises what the crons do not deliver, and nothing
reconciles the two.** Four separate rules exist for "does this contact count",
and they disagree:

| Surface                   | Rule                                      |
| ------------------------- | ----------------------------------------- |
| Calendar                  | recipient not `archived`                  |
| Approvals page and badge  | recipient not `archived`                  |
| Promotion cron            | recipient `active`                        |
| Click-and-forget approval | recipient `active` + source + type + list |

A fix that only aligns the statuses leaves the deeper problem: there is no
screen anywhere that answers "which of my contacts will **not** get a card, and
why". The plan should end with that screen existing.
