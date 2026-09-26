# 0272 — Switching on takes over what is already approved

## Status

Accepted

## Context

ADR 0270 gave the approved-but-unsent card a screen; ADR 0271 stopped the
approvals queue creating it. Neither helps the cards already in that state when
click and forget is switched on.

The approval cron reads `pending_approval` and nothing else. An `approved` card
carrying `asap` was therefore never touched by it: it waited for a human to
place an order, and was retired as `missed` once its date passed.

So somebody who worked through a fortnight of birthdays by hand and _then_
switched automation on got an instruction that said **"we are sending these
cards for you"** over a set of cards it would never touch. The screen was
truthful about everything it would do next and silent about everything already
decided.

## Decision

On the transition into running, the instruction takes over the cards already
approved and waiting.

**On the transition, and nowhere else.** Not on every save. Once the instruction
is running, leaving a card on `asap` is the escape hatch the approvals queue
offers (ADR 0271), and re-adopting it on the next unrelated edit — a changed
design, a reworded message — would quietly overrule somebody who had used it.
The check is `wasActive` read before the write against `nowActive` after, both
through `standingOrderBlockers`, which is the same rule the cron and the
customer-facing view use. Switching on and fixing the last blocker both count;
saving again while already running does not.

It runs inside the same transaction as the save, because switching on and taking
over the waiting cards are one act — a save that committed without the second
would leave the instruction claiming cards it had not taken.

**Bounded the way the cron is bounded, and then some.** Birthdays, rolling
per-recipient ones, active contacts, in the list when the instruction targets
one. Plus two the cron does not need:

- **Nothing whose posting date has gone.** A dispatch date already passed is not
  made good by sending the card late, and that is the account's call rather than
  ours.
- **Nothing we could not post to.** An adopted card for a contact with no
  address would leave the "waiting for you to order" list for the automated one
  and then fail silently at the cron. Left alone it stays on the screen that
  asks a person to fix it.

**The postage class and dispatch date are not re-timed.** Whoever approved the
card chose them. Adoption is a promise to send what they set up without asking
again, not licence to change it — which is also what the consent statement on
that page says about cards already on their way.

**The number is said out loud.** The save response carries a transient `adopted`
count, and the confirmation reads "Saved. We will take it from here, including 3
cards you had already approved." It is a change to work somebody had already
dealt with; the alternative is discovering it on another screen, or not at all.

## Consequences

The three ADRs close the loop: 0270 makes the state visible, 0271 stops the
queue creating it, and this one clears what was there before either existed. On
the account that prompted all three, switching click and forget on would now
adopt the seven cards that had to be repaired by hand.

Money moves for cards the subscriber had approved but not yet paid for. That is
the instruction they agreed to, stated on the same screen before they save, and
it still runs through the existing auto-send path with its wallet, plan and
address checks at send time. The wallet projection on that page already counts
committed cards, so the cost was visible before the save.

A card deliberately left on `asap` while the instruction runs is now the only
way to keep one back, and it survives every subsequent save. That makes the
untick in the approvals queue load-bearing, which is why 0271 gave it a reason
to exist rather than leaving it as the accident it was.
