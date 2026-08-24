# 0167 — A bulk send is birthday-timed unless it says otherwise

## Status

Accepted — implemented.

## Context

ADR 0119 established that a card matched to a real dated occasion posts on that
person's own date. ADR 0160 refined it. Both were correct, and both were
reachable only down one path.

`bulkSend` splits recipients in two: those with a matched occasion post on their
own date; everyone else gets a fresh one-off occasion dated the send day.
Matching came from `dto.reconcile`, and the composer only builds a `reconcile`
list when it was seeded from a segment (`/send?segment=…`). Pick the same
contacts from a list, from `?recipients=`, or by hand in the composer, and the
list is absent — so every card became a one-off dated today, even though every
recipient had a birthday on file.

ADR 0166's sibling change (#328) added `useOccasionDates`, which makes the server
find those occasions itself rather than trusting the browser to have carried them
through. It fixed the mechanism. It did not fix the outcome, because **nothing
ever set the flag**: a search across the web app, the API, the CRM integrations
and the auto-send path found no caller. The capability shipped unreachable, and
a bulk send from the composer went on dating every card the same day.

The cost of the two failure modes is not symmetric:

- A campaign card ("we've moved premises") posted on someone's birthday is odd.
- A birthday card posted eleven months early is a refund and an apology.

## Decision

Occasion dating is the **default** for a bulk send with no shared delivery date:

```ts
function usesOccasionDates(dto: BulkSendDto): boolean {
  return dto.useOccasionDates ?? !dto.deliverBy;
}
```

- No `deliverBy`, no flag → birthday-timed. The common case, and the one that was
  wrong.
- `deliverBy` given → one shared date. Choosing a delivery date *is* saying "one
  date for everyone".
- `useOccasionDates: false` → one shared date. The explicit campaign opt-out.
- `useOccasionDates: true` **plus** `deliverBy` → still a 400. Two different
  answers to "when does this post?", so refuse rather than silently pick one.

### The reconciliation collision

The composer's "mark these occasions as handled" toggle (ADR 0107) let a sender
opt out, meaning *send this card as well as their birthday card*. Turning it off
sent no `reconcile` list — a payload byte-identical to a hand-picked send. Under
the new default the server would have found the birthday anyway and consumed it:
precisely what the sender had said not to do.

The composer therefore now sends `useOccasionDates: false` when, and only when,
there were matches to opt out of. A send with no matches at all is the
hand-picked case and takes the default. The two intents stay distinct:

| Send | `reconcile` | `useOccasionDates` | Result |
| --- | --- | --- | --- |
| From a segment, toggle on | matches | — | Birthday-timed, occasion consumed |
| From a segment, toggle off | — | `false` | One shared date, birthday untouched |
| Hand-picked / list / `?recipients=` | — | — | Birthday-timed (the fix) |
| Any send with a delivery date | — | — | One shared date |

## Alternatives considered

**Add a timing choice to the composer, defaulted to birthdays.** Better in the
long run and still worth doing, but it leaves every non-composer caller — the
CRM integrations, the API — on the old behaviour, and it was the composer's
route-dependence that caused the incident.

**Leave it opt-in and rely on the re-date repair.** The repair (ADR in #329) is a
good backstop, but it only runs after someone notices. Nobody noticed for 76
cards; it was caught by eye.

**Infer from the design or occasion type.** "Does this look like a birthday
card?" is a guess, and a wrong guess here misdates real post.

## Consequences

- A bulk send to contacts who have birthdays on file now spreads across the year
  rather than posting in one batch. That is the point, and it is a visible change
  for anyone who was relying on the old behaviour without setting a delivery date.
- A genuine same-day campaign to contacts with birthdays needs either a delivery
  date or `useOccasionDates: false`. The composer only sends the flag when the
  sender opted out of reconciliation, so a hand-picked campaign send currently
  has no way to say "one date" other than choosing a delivery date.
- **The composer's copy now understates what happens.** It says "send now" while
  the server may spread the send across the year. Adding an explicit timing
  choice to the composer is the follow-up, and is what makes this legible rather
  than merely correct.
