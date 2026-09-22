# 0258 — The page that switches it on

## Status

Accepted

## Context

Phase C7 of `docs/click-and-forget-plan.md`. ADR 0256 built the standing
instruction and the consent; ADR 0257 built the approval run that reads them.
Both shipped without a single screen, so nobody outside this repo could set one
up. This is that screen.

It is also the first point in the feature where the product makes promises out
loud, which is the whole difficulty: the machinery is not finished, and a page
is very good at implying that it is.

## Decision

One page at `/click-and-forget`, in the sidebar under **Send cards** rather
than under Settings. It is not a preference; it is the other way of sending.

### It says what is not built yet

The message pool is saved and **nothing prints it** — applying a chosen message
is C5, which waits on the catalog work. So the message editor carries a notice,
in the same block as the editor rather than in small print at the bottom:

> **Not printed yet.** Your messages are saved, and right now each card still
> carries the message already on the design you chose.

The alternatives were both worse. Hiding the editor is impossible — the API
refuses to switch an instruction on with an empty message pool, so nobody could
enable anything. Showing it silently would have a customer write five messages,
switch it on, and discover months later that no card ever carried one.

A test asserts the notice is present, and the mutation that removes it fails.

### "On" and "running" are two different words on the screen

`enabled` and `active` are separate in the API for a reason (ADR 0256), and the
page keeps them separate: a green "we are sending these cards for you" strip
only appears when the instruction is genuinely running. A switched-on
instruction that something is stopping gets an amber strip and a list of the
blockers in plain language.

The blocker copy is a `Record` keyed on the code, not a lookup with a fallback,
so the API gaining a blocker fails the build here until somebody decides what a
customer should read. The `??` that follows covers exactly one case: an API
ahead of this deploy.

### Smart lists are refused in two places

C6 does not act on a smart-list audience, because a smart list is a rule whose
membership moves on its own. The page therefore does not offer one — the
audience choices are "everybody" and "one of my lists" — and an instruction
already pointed at a segment gets a notice in the audience section telling them
to choose again, as well as the blocker banner explaining why nothing is
happening.

Two places on purpose. The banner says why it is stopped; the notice sits where
they fix it.

### Free sees the whole thing

Every control is laid out and saveable on Free. Only the "send these cards for
me" switch is disabled, and the upgrade prompt sits at the top with a link to
plans.

This was the explicit instruction — keep it visible on Free with a prompt to
upgrade — and it is also the version that reduces the barrier rather than
adding one: the prompt reaches somebody who has already chosen their cards and
written their messages, rather than somebody looking at a locked empty page.

### The switch cannot be reached before the wording is read

Agreeing is a checkbox under the statement itself, and the "send these cards
for me" switch is disabled until it is ticked. Somebody whose recorded consent
has gone stale (ADR 0256's versioning) sees the box unticked and a line saying
we have changed how it works.

## Consequences

- A subscriber can now set up click and forget without an API client, which is
  the first time any of C1, C2, C4 or C6 is reachable from the product.
- The page tells the truth about an unfinished feature in three places: the
  message notice, the on-versus-running distinction, and the smart-list refusal.
  All three are pinned by tests, and all three mutations fail.
- The web guards earned their keep again: `check-jsx-text.mjs` caught two
  `&amp;` entities in the heading and the upgrade banner, which would each have
  silently eaten a space.
- C8 (the messaging) is now the only phase with nothing built, and it should not
  start until the message notice above can be deleted.
