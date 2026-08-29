# 0174 — The approvals queue lets go, and skipping is no longer a one-way door

## Status

Accepted — implemented.

## Context

A school reported that a bulk send they meant as a birthday campaign came out
labelled "Bespoke campaign", with eleven of twelve cards posting on one day
instead of on each child's birthday.

The audit trail says what happened, to the second:

| Time  | What                                             |
| ----- | ------------------------------------------------ |
| 08:44 | Opens Approvals                                  |
| 08:45 | Starts skipping                                  |
| 08:49 | Has skipped **27 birthdays**, about one a second |
| 09:04 | Builds the twelve-card send, pays                |

They cleared the queue fifteen minutes before ordering. A skipped occasion is
invisible to the send matcher, so eleven of the twelve fell through to a fresh
one-off occasion typed `bespoke_campaign`. The one card that came out right —
Cameron Mendes — was the only one of the twelve they had not skipped.

The same 27 clicks explain their earlier report that Approvals was empty.

### Why they were clicking

**Seventeen of the 27 were birthdays that had already passed.** The account was
migrated in on 9 August; by the 29th the queue held three weeks of dates nobody
could do anything about.

Because the queue had no exit. An occasion promoted into it that nobody actioned
stayed for ever, its date sliding quietly into the past. No sweep retired it, and
`promoteDueOccasions` had an upper bound only — resting on a comment that
`nextBirthdayOccurrence` never returns a past date, which is true of the moment
an occasion is created and says nothing about it three weeks later.

So the pile grows for as long as an account exists. A year-old account would
carry hundreds. This was never specific to migrated customers; migration only
made it arrive sooner, because a year of contacts lands at once.

A queue of things you cannot act on is not merely untidy. It teaches the reader
that the queue is noise, and the fastest way to make noise go away was a button
that quietly destroyed data.

## Decision

**The queue retires what it can no longer send.** A daily sweep moves
`pending_approval` occasions whose date has been to `skipped`, and the promotion
rule gains the lower bound it always needed so nothing refills the queue from
behind. Both run in the existing recurring job, so the admin "run it now" button
(ADR 0172's sibling) clears the backlog on every account at a press.

A birthday **today** is left alone. It is too late to arrive on the day, but
sending it late is the customer's call, not ours to take away.

**`skipped`, not a new status.** A lapse and a deliberate skip are already told
apart by two facts we keep: a lapsed occasion is always in the past, and a
deliberate skip leaves an audit entry naming who did it. A new enum value would
ripple through every status filter in the codebase to record something the data
already says. The sweep writes no per-occasion audit either — it runs
platform-wide with no human behind it, `actorUserId` is required, and a row per
occasion would mean thousands of entries attributed to an invented user. It logs
its count instead.

**Skipping is reversible.** `POST /occasions/:id/unskip` returns an occasion to
the queue, guarded to dates still ahead — restoring one that has gone would put
an un-sendable card back in the pile the sweep exists to clear. Approvals keeps
every skip from the current visit in an undo strip, so the mistake that took
seconds to make takes seconds to fix.

**Clearing a backlog is one act, not N.** Tick many (or all) and skip them
together. Twenty-seven clicks at one a second is a machine for overshooting.

**The composer stops calling a skipped birthday "no occasion on file".** The
preflight counts skipped-but-ahead contacts separately and the send screen names
them: _"6 have birthdays coming up that were skipped… restore them in Approvals
first."_ That line is the last point at which this is cheap to fix, and it was
telling the sender something untrue.

## Consequences

Approvals now shows only what can still be acted on, which is what makes the
other four changes worth having — a reversible skip on a queue nobody trusts is
a better undo for a mistake that should not be invited.

The nightly job reports a fourth number (`lapsed`), surfaced on the admin button
so an operator can see a backlog being cleared rather than infer it.

A skipped occasion is still invisible to the send matcher, deliberately: that is
what "skip" means. The change is that a person can see it happened and put it
back.

Verified by reverting each half in turn: removing the sweep fails two cases,
dropping the promotion's lower bound one, lapsing on `<=` today instead of `<`
one, dropping `unskip`'s date guard one, dropping its account scope one, and
folding the skipped count back into "no occasion on file" one. One mutation
initially survived — a missing bound on the preflight count — and the case that
now catches it was written before it was fixed.
