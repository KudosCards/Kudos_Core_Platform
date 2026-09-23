# 0264 — What it covers, and what it costs

## Status

Accepted

## Context

Phases D4 and D5 of `docs/click-and-forget-improvements-plan.md`.

The page asked somebody to hand over their birthdays without telling them two
things it already knew:

- **How many contacts that actually is.** "Everybody — every contact with a
  birthday on record" does not say that this is 26 people, or that 4 of them
  have no postal address and will produce a skip notice rather than a card.
- **Whether their money reaches them.** The consent statement says cards are
  paid from the wallet and that we will say when the balance will not cover
  one. The page then showed no balance, no projection, and no way to switch on
  the automatic top-up that exists to prevent exactly that.

Neither number needed inventing. Both existed and neither could be asked for.

## Decision

### Coverage: the same "postable" everyone else means

`RecipientsService.readinessFor` has computed total / with a birthday / with an
address / sendable since ADR 0214, for CRM imports. The definition was right and
the scope was wrong: it filtered by ingest source, and this page needs an
audience.

Both now go through one private `readinessOf(where)`, so the number under
somebody's audience is the same "postable" the contacts list, the dashboard's
"needs address" count and the send path mean (`MISSING_ADDRESS_WHERE`,
ADR 0067). A fourth definition of postable would be worse than no number at all
— the whole value of this line is that it agrees with everything else the
product will later say.

`GET /recipients/readiness?listId=` serves it, declared **above** `:id` because
Nest matches in order and "readiness" would otherwise be parsed as a contact id.

Three details worth stating:

- **It follows the radio buttons.** Switching from everybody to a list of four
  while the page still reads "26 contacts" would be telling somebody something
  false about what they are switching on, so the count is refetched when the
  audience changes — and the arrival render is served by the server, already
  scoped to the saved audience, so the page never opens with a number it then
  corrects.
- **The gaps are named, not just the total.** "22 of 26 contacts will get a
  card. 2 have no birthday on file, and 2 have no postal address" is something
  to act on; "26 contacts" is not.
- **A count we could not fetch says nothing.** Explicitly not zero: a failed
  request rendering as "there are no contacts here yet" would be a lie told to
  somebody with four hundred, and it is pinned by a test that survived a
  mutation the first version of it did not.

### The money, where the promise is made

`GET /wallet/projection` serves ADR 0255's projection — the 9am watch's own
method, on the same 30-day horizon, rather than a second calculation. Two
readers, one definition: a page and an email that disagreed about whether the
money reaches the birthdays would be worse than either alone.

It reads as the watch's email does — _"That covers the next 6 of 9 cards —
Grace Bell's, on 14 October, is the first it will not reach"_ — because a
threshold answers a question nobody asked.

`AutoTopUpCard` moved to `components/` and is rendered here as well as on the
wallet page. A link to settings was the alternative; embedding wins because the
sentence that creates the worry is three inches below it, and a link is a second
page and a lost thought.

That gave the page two buttons reading "Save", which is a page that cannot tell
you which of your changes it kept. The card now takes a `saveLabel`, and says
"Save top-up settings" here.

### Failing quietly, per block

Each of the three new reads is allowed to fail on its own: a page that cannot
price the next month is still a page somebody can choose their cards on, and a
page that cannot read the wallet shows no money section rather than an empty
one.

## Consequences

- The page now answers both questions somebody has before switching this on,
  from data that was already there.
- `ingestReadinessSchema` is now an alias of `contactReadinessSchema`, which
  lives with contacts because two screens ask it.
- `WalletController` depends on `WalletWatchService`. That is the right way
  round — the watch owns the projection — and the alternative was a copy.
- With D1–D6 all built, the second pass over this page is complete. What is
  left for click and forget is not code: the catalog description pass, and a
  real standing order posting a real card.
