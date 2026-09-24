# 0266 — What archiving a contact means

## Status

Accepted

## Context

The ops director reported that the sidebar said **3 waiting for approval** over
an approvals page that said **"Nothing waiting for approval right now."**

There is no way to delete a contact. `RecipientsService.archive` sets
`status: "archived"` and touches nothing else, so archiving is the only way a
customer can stop us sending to somebody — and the rule that follows from it was
already written down, in the promoter that fills the approvals queue:

> Don't pull an archived recipient's occasion into the approvals queue.

Four places implement that rule: the occasions list behind the approvals page
and the calendar, the promoter, the nightly scheduler, and the standing-order
approval cron. Five places did not.

## Decision

### The rule gets a name

`VISIBLE_OCCASION_WHERE`, exported from `occasions.service.ts` beside the query
that already implemented it. The rule was stated three times in comments and
implemented once; naming it is what makes "the badge counts what the page shows"
a fact rather than an intention.

An occasion with no recipient at all stays visible: it is nobody's archived
contact.

### The counts now count what the page shows

- **The sidebar badge** (`getNavBadges`) — the reported bug.
- **The dashboard tile** (`getSummary`), the same count in the same file.
- **The notification bell** (`getFeed`), which said "N occasions need approval",
  and its "coming up" list beside it, which had the same hole.

A customer reading "3" over a page that says "Nothing waiting" has no way to
tell which of the two is lying, and no way to clear it — the occasions are
invisible by design, so there is nothing to act on. The badge was the only
symptom; the count was wrong in three places.

### Reminders stop nagging about archived contacts

`RemindersService` emailed a daily digest that included them. Archiving somebody
and then being reminded about their birthday every morning is the same mistake
as the badge, in the customer's inbox.

That clause is added under `AND` rather than spread into the `where`. The query
already has an `OR` for the dispatch-date fallback, and a spread would have
replaced it — silently widening the reminder window while narrowing the
audience. TypeScript caught it (`'OR' is specified more than once`); no test
would have.

### Auto-send no longer posts to somebody who was archived

The serious one, found on the way to the badge.

`AutoSendService.runDue` selects on status, dispatch option and date, with no
recipient filter, and none of its seven skip conditions mentioned archiving. So
a card approved before the contact was archived was still printed, paid for out
of the wallet, and posted to them. Archiving is the only way to stop that, and
it did not.

Checked in `autoSendOne` rather than filtered out of the due query, on purpose:
a card that does not go is something the customer hears about (ADR 0254), and
silence is exactly what that phase exists to prevent. It gets its own reason
code, `recipient_archived`, so the exhaustive copy switch forced somebody to
decide what a customer reads — _"You archived this contact, so we did not send
their card."_

## Consequences

- Five sites now share one rule, and the sixth (the queue) keeps the behaviour
  it always had.
- A restored contact brings their occasions and their counts straight back,
  which is pinned by a test.
- The reproduction is in `apps/api/test/archived-contact.e2e-spec.ts`, written
  against the code as it was: all five assertions failed before the fix.
- One of those five initially passed for the wrong reason — an unfunded wallet
  stopped the auto-send before the archive could — so the test now funds the
  wallet and asserts the balance is untouched. A test that passes because of
  something it is not testing is worse than no test.
