# 0271 — Approving should not opt out of the automation

## Status

Accepted

## Context

ADR 0270 gave the approved-but-unsent card a screen. This is the reason it was
being created.

An account with click and forget running had seven birthdays approved as `asap`
and one as `auto_send`. Nothing in the product did that: a person did, from the
approvals queue, taking the default each time.

The queue's auto-send toggle started **off**, on an account whose owner had
switched on an instruction that says _stop asking me, order and post these
automatically_. So every card approved by hand quietly left the automation. The
page could not have known better — it fetched entitlements and nothing else, and
had no idea the standing order existed.

The result is a default that contradicts the account's own instruction, with the
consequence deferred by weeks and visible nowhere until the birthday passes.

## Decision

When the standing order is **active**, the approvals queue starts each card on
auto-send, and says so.

`active` is read from `GET /standing-order` — the API's own "switched on and
nothing blocking it", which is the same rule the approval cron uses
(`standingOrderIsActive`). Not a second definition: two of those would drift, and
the drift would read as a card that went when the screen said it would not.

Three things this deliberately does not do:

**It does not tick a box the server would refuse.** Approving for auto-send is
rejected when the contact has no postal address, so the default is applied per
row and only where that address exists. Offering a pre-ticked box that fails on
submit is a dead end the person cannot get out of — and the row says _"No postal
address, so this one can't be auto-sent"_ rather than leaving an unexplained gap
on a screen that has just announced everything is automatic.

The rule behind that is now `hasPostalAddress` in `@kudos/shared-types`, used by
both the queue's default and the server's gate. It had three separate spellings:
the API's falsiness check, the ops "missing address" query, and an inline
trimmed check on the contact screen. None of them is currently reachable with a
whitespace-only field — every write path trims or blanks-to-null first, so the
trim is defensive rather than a bug being fixed. What the shared rule buys is
that the client's default and the server's gate cannot come apart later, which
is the pairing this ADR depends on.

**It does not change what happens without the instruction.** No standing order,
or one that is blocked, and the toggle starts off exactly as before. The default
moves only for the account that asked for it.

**It does not take the choice away.** Unticking for one card still works, and
there are real reasons to want a card in your own hands. It becomes a decision
rather than an accident, which is all that was wrong with it.

## Consequences

The state ADR 0270 surfaces should now be rare, and deliberate when it happens.
Together they form a pair worth naming: 0270 makes the failure visible, 0271
stops it being created, and the first is what makes the second checkable rather
than believed.

A subscriber who approves from the queue on a click-and-forget account will now
have cards ordered and paid from their wallet where previously they would have
been asked again at the ordering step. That is what the instruction they signed
says, the banner states it before anything is approved, and the money still
moves only through the existing auto-send path with its own wallet, plan and
address checks at send time.

The approvals page now makes a fourth request per load. It is the smallest of
the four and it is the one that decides whether the screen is telling the truth.
