# 0270 — The approved card nobody will send

## Status

Accepted

## Context

An account with click and forget running, covering 148 of 148 contacts, had one
card scheduled to send and seven that never would. Their ops director noticed
because the calendar showed eight birthdays and the Approvals page showed one.

The seven were not missing. They were **approved**, with a design chosen and a
dispatch date set. One field separated them from the eighth:
`dispatchOption: "asap"` where hers was `"auto_send"`.

That single field decides whether anything happens next. The auto-send cron
acts only on `auto_send`; an `asap` card waits for a human to place and pay for
an order. And nothing tells anybody it is waiting:

- **The Approvals page could not show it.** It listed `pending_approval` and
  `approved` + `auto_send`. An approved `asap` card matched neither — it had
  left the approvals queue and joined no other.
- **The calendar could not tell it apart.** Automated, awaiting payment and
  not-yet-promoted all render as the same yellow "Upcoming" pill.
- **The nightly sweep wrote it off.** `retirePastOccasions` retires any approved
  occasion whose date has passed to `missed` — case 2 in its own docstring,
  "approved, a design chosen, and then never ordered".

So a card could be approved, paid attention to, and then lost, with every screen
in the product looking normal throughout. Two of the seven had to be posted four
days after the video was recorded.

## Decision

The Approvals page gains a third section: **Approved, waiting for you to order**.

It lists `approved` + `asap` — read through the existing
`?status=approved&dispatchOption=asap` filter, which the API already supported
and nothing used — and against each one says **how long is left**, not the date
it is left until. "Must post in 2 days" is something an operator can act on;
`1 Oct` is arithmetic homework that has to be done correctly eight times before
anyone notices the one that matters. A posting date already gone says so
plainly, because a card that cannot arrive on time still needs a decision.

Three details worth keeping:

**Today is not late.** A card whose posting date is today is still actionable,
and calling it missed would send somebody looking for a refund instead of a
button. The comparison is between UTC calendar days rather than timestamps —
subtracting `Date.now()` from a midnight date column reads as −1 for most of the
working day, which would mark every card due today as already lost.

**Today is resolved on the server** and passed down. Computing it inside a
client component makes the server and the browser disagree across midnight and
across timezones, which is a hydration error on the one screen whose whole job
is to be trusted about dates.

**The section is absent when empty.** It is an alarm, and an alarm that appears
on every visit is one nobody reads.

## Consequences

The state that lost seven cards is now visible, with a route to fixing it and a
deadline attached. Nothing about the sending rules changes: this is a read and a
link. No card is sent that a human did not approve, and no default moves.

"Nothing waiting for approval right now" can now appear directly above a list of
cards nobody is going to send. That reads oddly, and it is honest — the approvals
queue really is empty, and these really are unsent. A test pins both being on
screen together so the empty-queue message can never again be the only thing an
operator sees.

It does not stop the state being created. Approving from the queue still
defaults to `asap` even on an account running click and forget, and the page
still does not know the instruction exists — that is F1 in
`docs/click-and-forget-capture-plan.md`, and it is the fix at the point of
failure. This is the one that makes that fix verifiable rather than believed,
which is why it went first.
