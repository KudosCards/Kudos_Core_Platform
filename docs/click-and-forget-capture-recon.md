# Why click and forget captured one student out of eight

## The report

Chris, 24 September 2026, on the Darlington Kip McGrath account:

> This student (Izobella Ross) is shown as auto-send for 8th Oct but looking at
> the calendar there are a number of other students which should be captured.

Click and forget is on and reports **Running**, covering **148 of 148**
contacts. The calendar shows eight birthdays in the next three weeks. One is
scheduled to send.

## What the data showed

The seven "missing" students are **not** missing. They are **approved**, with a
design chosen and a dispatch date set. Every one of them:

| Contact             | Birthday | Posts      | Status   | Dispatch option |
| ------------------- | -------- | ---------- | -------- | --------------- |
| Ryan Mafukidze      | 3 Oct    | **28 Sep** | approved | `asap`          |
| Katie Baker         | 5 Oct    | **28 Sep** | approved | `asap`          |
| Freddie Etherington | 8 Oct    | 1 Oct      | approved | `asap`          |
| Blessing Mavindi    | 8 Oct    | 1 Oct      | approved | `asap`          |
| Chloe Clark         | 9 Oct    | 2 Oct      | approved | `asap`          |
| Hannah Kirby        | 12 Oct   | 5 Oct      | approved | `asap`          |
| Anna Scott Wailes   | 12 Oct   | 5 Oct      | approved | `asap`          |
| **Izobella Ross**   | 15 Oct   | 8 Oct      | approved | **`auto_send`** |

One field separates Izobella from the rest, and everything follows from it.

**`asap` means a human still has to pay.** The auto-send cron only ever acts on
`dispatchOption: "auto_send"` (`auto-send.service.ts:391`). An `approved` +
`asap` card waits in the Orders basket for someone to place and pay for an
order. Nothing chases it.

**The Approvals page cannot show them.** It lists exactly two things: occasions
that are `pending_approval`, and occasions that are `approved` **and**
`auto_send` (`approvals/page.tsx:16,22`). An approved `asap` card matches
neither. It has left the approvals queue and joined no other.

**The calendar cannot distinguish them.** Approved-and-automated,
approved-and-waiting-for-payment, and not-yet-ready all render as the same
yellow "Upcoming" pill.

**And then they are quietly written off.** `retirePastOccasions` moves any
`approved` occasion whose date has passed to `missed` — case 2 in its own
docstring, "approved, a design chosen, and then never ordered". So these seven
become `missed` after their birthdays, with no card sent and nothing said.

Two of them had to be posted on **28 September**, four days after Chris recorded
the video.

## The cause

`approveWithCheckedDesign` defaults to `asap`:

```ts
const dispatchOption = dto.dispatchOption ?? "asap";
```

and the Approvals page defaults its auto-send toggle to off
(`autoSendByOccasion[occasion.id] ?? false`, `useState(false)` for the bulk
one). **The Approvals page never fetches the standing order at all** — it has no
idea click and forget is running.

So on an account whose owner has switched on "stop asking me, send these
automatically", working the approvals queue by hand silently opts each card
_out_ of that automation, one card at a time, with no warning and no visible
consequence until the birthday passes.

That is what happened here. Someone approved these seven from the queue before
the 06:30 cron reached them, taking the default each time.

**And turning click and forget on does not adopt cards already approved.** The
approval cron only ever reads `status: "pending_approval"`
(`standing-order-approval.service.ts:135`). Anything approved before the
instruction was switched on stays `asap` for ever.

## Two corrections to my earlier reading

**The badge was not stale.** I said the "3" beside Approvals was a number the
page had already dealt with, because `approvals-client.tsx` never calls
`router.refresh()`. That is a true statement about the code and it was the wrong
explanation. The account has exactly **three** `pending_approval` occasions
belonging to **archived** contacts — pearl goredema, odile m, lynn kirby. The
badge before ADR 0266 counted `pending_approval` without excluding archived
recipients, which is exactly 3, while the page never showed them. Chris's
screenshot predates that deploy. Query 4 now returns **0**, which is the fix
working.

**`lapsed` is not implicated here.** The account has 148 active and 105 archived
contacts and no lapsed ones. The finding stands on its own — `lapsed` is set by
nothing, defined nowhere, excluded by both crons and included by the calendar —
but it is not what Chris saw, and it should be ranked accordingly.

## Still true, and still worth fixing

**A birthday created by hand can never be auto-sent.** `POST /occasions` writes
`source: "one_off_campaign"` whatever type was asked for, and the approval cron
requires `recurring_per_recipient`. Not implicated on this account — every row
is `recurring_per_recipient` — but it is a live trap for anyone using
**+ New event**.

**Archiving a contact leaves their occasions behind.** Four rows here belong to
archived contacts: three sitting in `pending_approval`, one in `scheduled`. They
are invisible on every screen now and will be retired as `missed` in due course.
Harmless, but it is why the badge read 3.

## Izobella's send date

Computed with the real function: five working days before Thursday 15 October is
Thursday 8 October. Her date is **correct** — send-by-5 applied exactly
(ADR 0115).

The fair point underneath Chris's remark is a different one. Send-by-5 posts
five working days ahead, so a card typically lands two to three days _before_
the birthday rather than on it — deliberate, since it is what stops anything
arriving late. But the calendar hides posting dates behind a **Dispatch dates**
checkbox that is off by default, so an operator reading the calendar cannot see
when anything actually posts, and "posts around 8 October" against a 15 October
birthday reads oddly with no way to check it.

## The shape of the problem

Not "some contacts were missed". The product has **two ways to approve a card
and only one of them is automatic**, they are chosen by a checkbox that defaults
to the manual one, and the screen presenting that checkbox does not know the
account has already asked for automation.

Everything else follows: the approved `asap` card has no home screen, the
calendar cannot tell it apart, and the sweeper writes it off in silence.
