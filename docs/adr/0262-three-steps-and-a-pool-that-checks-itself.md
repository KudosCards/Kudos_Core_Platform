# 0262 — Three steps, and a pool that checks itself

## Status

Accepted

## Context

Phases D1–D3 of `docs/click-and-forget-improvements-plan.md`: the second pass
over the page a subscriber sets click and forget up on.

The page shipped in C7 (ADR 0258) as six identical white cards in a column. It
worked, and reading it with fresh eyes turned up one fault that mattered more
than the way it looked.

## Decision

### The pool now says when a card is not a birthday card

`checkDesigns` validated that a design existed and was not archived, and
nothing else. The instruction only ever sends birthdays. The live account's
pool held two good-luck cards and a milestone card, so somebody's birthday
could arrive as a clover — every year, in silence, with nothing on the screen
that could have said otherwise.

The catalog knows: a saved design carries the `cardDesignId` it was copied
from, and that row has the occasion it was filed under. So `GET /saved-designs`
now carries `category`, and `catalogSaysBirthday` answers in three states:

- **true** — it resolves to the birthday category.
- **false** — the catalog said something and it was not birthday. An occasion
  that never made it onto the published vocabulary ("good luck") still answers
  false: an unrecognised word is not a birthday either.
- **null** — nobody said. No catalog row at all (a member's own artwork) or the
  sync's `uncategorised` fallback for an empty cell.

Null must not collapse into false. The difference decides whether we may tell
somebody their card is for the wrong occasion, and a warning we cannot stand
behind is worse than no warning — the same distinction ADR 0259 draws between a
null attribute and a deliberate "any".

**Warned, by name, and not blocked.** There may be a reason to send a clover;
there is no reason to do it by accident. Blocking would also be a new way for
this page to refuse a design a subscriber deliberately chose, and C5 settled
that argument already: prefer, never exclude.

### `takesMessage` answered "no" for every design ever made

Found while moving the rule so the page could ask it too.

`takesMessage` decides whether a chosen message would actually be printed, by
running the real placement over the design and looking for what came back. The
probe was `"\u0000kudos-probe\u0000"`, and the search was
`JSON.stringify(...).includes(probe)` — which escapes those NUL characters to
the six literal characters `\u0000`. The needle and the haystack were never
written the same way, so the answer was always false.

What a subscriber saw: _"N of your cards will not use these… Those cards go out
with the words already on them"_, about every card they had chosen, while the
send path printed their messages perfectly well. The feature worked and the
page said it did not.

Nothing read the field in a test — the web fixtures supplied `takesMessage` as
data, and no API test asserted it — which is exactly how it got out. It is now
pinned in three places: the rule's own unit tests, an e2e that reads the field
off `GET /standing-order`, and the page's tests. Each was confirmed by putting
the old probe back and watching them fail.

The probe is plain ASCII now. A probe is only useful if it survives the search.

### One rule, two callers

`designTakesMessage` moved into `card-message-slot.ts`, beside the placement it
probes, because the API reports the pool it has stored and the page warns about
a card the moment somebody picks it. Two copies of "would this print?" would
drift, and the drift is a page promising a message that never appears.

The same reasoning moved `SavedDesignThumb` into `components/`: the design
library and the pool are now showing the same cards to the same person.

### Three steps rather than six boxes

Who gets a card → what we send → how it is paid for and switched on. The order
is the order of the decision, and the weight now follows it: a two-option
audience is not as big a moment as agreeing to unattended spending, and the
first draft gave them the same box.

Two consequences worth naming:

- **The cards are visible.** Text chips cannot tell "Best of Luck Clover" from
  "Best of Luck Clover copy"; pictures can. The page already fetched the
  documents and discarded them.
- **Save is always in reach**, in a bar that says whether there is anything to
  save. On a page this long the old button was below the fold, and a page that
  looks identical saved and unsaved is a page that loses work.

### Adding a card no longer means leaving

`TemplatePickerModal` already solved this on bulk send. It gained a `title` and
`description` so it can say what it is for, and this page offers **birthday
templates only** — filtered by the API's own category, so a card is a birthday
card here exactly when the catalog says it is. Offering a get-well card to add
to a birthday pool would be offering a mistake.

A card added this way lands already chosen, because somebody who just picked it
out of the catalog has decided.

### Merge fields, from the same list the editor uses

A "+ First name" button and the rest of `MERGE_FIELDS` behind a select, with
the caret put back where it was. Typing `{firstName}` from memory is what this
replaces, so dropping the token at the end and stealing the focus would be no
improvement.

## Consequences

- One shipped bug fixed, and the page stops contradicting the product.
- A pool containing a non-birthday card now says so, which the live account
  will see the next time it is opened.
- `GET /saved-designs` carries one more field. `savedDesignListItemSchema`
  describes it rather than an optional field on the shared design schema, so a
  reader can tell "no catalog row" from "did not ask".
- Still to come in this pass: what the audience actually covers (D4), the
  wallet and its projection on the page (D5), and the drafting button (D6).
