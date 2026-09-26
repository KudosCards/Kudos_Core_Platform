# Making click and forget mean what it says

Recon: `docs/click-and-forget-capture-recon.md`.

Seven cards on one account are approved, designed, dated — and will never be
sent, because they carry `dispatchOption: asap` instead of `auto_send` on an
account that asked for automation. They appear on no approvals screen, look
identical to everything else on the calendar, and will be written off as
`missed` after the birthday.

The product has two ways to approve a card, only one of which is automatic, and
it picks the manual one by default on an account that has explicitly asked not
to be asked.

## F0 — The seven cards, now

Ryan Mafukidze and Katie Baker had to post on 28 September. Every one of these
dates is in the past or nearly so, and a fix that ships next week does not send
them.

This is an ops action, not a deploy: either place the order for those seven from
the Orders page, or run a one-off UPDATE moving them to `auto_send` so the cron
picks them up. The SQL sits in `docs/ops/adopt-approved-into-auto-send.sql`,
scoped to one account, `approved` only, dated forward only, and reversible.

**This has to happen before anything below.** The rest stops it recurring; it
does not rescue these.

## F1 — Approving from the queue must not opt out of the automation

The fix at the point of failure.

When a standing order is enabled and unblocked, the approvals queue should
default its auto-send toggle **on**, and say why in one line the operator can
read — _"Click and forget is running, so this will be sent and paid for
automatically."_ Turning it off for one card stays possible, because there are
real reasons to want a card in your own hands, but it becomes a decision rather
than an accident.

This needs the Approvals page to know the standing order exists, which today it
does not — it fetches entitlements and nothing else.

The same applies to the bulk approve, which is the likelier culprit given seven
cards took the same path.

## F2 — Switching it on adopts what is already waiting

Turning click and forget on today changes nothing about cards already approved:
the cron reads `pending_approval` only. Somebody who approves a fortnight of
birthdays by hand and _then_ switches automation on is left with exactly this
account's situation.

On enable, adopt the account's `approved` + `asap` + `recurring_per_recipient`
birthdays whose dispatch date has not passed, and say how many were adopted.
Bounded the same way the approval cron is bounded, and it must not touch
anything a human deliberately set to `asap` **after** the instruction was
enabled — which is `updatedAt` against the standing order's `updatedAt`, not a
guess about intent.

## F3 — An approved card that nobody will send needs somewhere to be seen

Today the Approvals page shows `pending_approval` and `approved + auto_send`.
The gap between them is a real state with real money attached and no home.

Add a third section — _Approved, waiting for you to order_ — listing
`approved` + `asap` with its dispatch date and a direct route to ordering. When
its dispatch date is within a few days, say so loudly.

This is the screen that would have shown Chris the answer in one look instead of
a video, and it is worth more than either fix above.

## F4 — The calendar should distinguish ready from not-ready

Three different states render as the same yellow "Upcoming" pill: automated,
approved-but-unpaid, and not-yet-promoted. An operator cannot tell a card that
is going to arrive from one that is not.

Give approved-and-automated its own treatment, and show the posting date on the
pill rather than behind a **Dispatch dates** checkbox that is off by default.
Chris's second remark — that Izobella's send day looked wrong — came from not
being able to see posting dates at all; her date was correct.

## F5 — The traps next door

Smaller, established from the code, none of them implicated on this account, all
of them the same class of defect.

- **`lapsed` contacts are excluded by both crons and included by the calendar.**
  Nothing sets the status, no ADR defines it, and it silently stops cards. Either
  define it or remove it; leaving it selectable in the smart-list rule builder
  while it quietly disables sending is the worst of the three options.
- **A birthday created through + New event can never be auto-sent**, because
  `POST /occasions` hardcodes `source: "one_off_campaign"` whatever type was
  asked for.
- **Archiving a contact leaves their occasions in `pending_approval`**, where
  nothing will ever show them.
- **The approvals badge is never refreshed after the queue is drained** — the
  client mutates its own state and never calls `router.refresh()`, where nine
  other clients under `(app)/` do. Not the cause of Chris's "3", but real.

## What this does not do

**No card is sent automatically that a human did not ask for.** F1 changes a
default on a screen, with the instruction named; F2 adopts only cards already
approved by a human on an account whose owner switched automation on. Neither
invents consent.

**The send-by-5 rule is not touched.** Cards arriving two or three days early is
deliberate (ADR 0115) and is what stops anything arriving late. F4 makes it
visible; changing it is a separate decision with the print schedule attached.

## Order

F0 today, because those dates are passing. Then F3 — the missing screen is worth
more than the defaults, and it is what makes F1 and F2 verifiable rather than
believed. Then F1, F2, F4, F5.
