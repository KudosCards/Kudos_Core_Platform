# 0214 — An import that cannot send a card is not a success

## Status

Accepted — implemented. Not from the external review; raised while challenging
whether the GoHighLevel integration actually serves what it is for.

## Context

Kudos posts physical birthday cards. Two fields per contact decide whether that
is possible: a **date of birth**, to know when, and a **postal address**, to know
where. Both are optional in every CRM we read — GoHighLevel, HubSpot, Brevo — and
nothing in the ingest requires them. Contacts land either way.

The sync then reported:

> Imported 500 new, 0 updated (of 500 fetched).

In green. A customer reading that has every reason to believe five hundred people
are now on the birthday calendar. The truth might be twelve. Nothing on the
screen distinguishes the two, and the gap only shows up months later as cards
that never went out.

At two connected subscribers this is a conversation. At the scale the
integration is being published for, it is a churn problem nobody can explain:
the integration "worked", the numbers were green, and the cards didn't come.

This is the same defect as findings 5, 17, 19 and 21 in the external review, and
as ADR 0212 and 0209 — a screen stating something that isn't true — arrived at
from the opposite direction. Those were bugs found by reading code. This one was
found by asking what the feature is _for_.

## Decision

`IngestResult` carries an `IngestReadiness`: `total`, `withDateOfBirth`,
`withPostalAddress`, and `sendable` — the count that can actually receive a card.

**Measured on what is stored, not on the payload.** Updates merge rather than
clear (ADR 0186), so a contact the customer completed by hand in Kudos is
sendable even when the CRM carries nothing for them. Counting the incoming rows
would understate the truth and send people to fix a CRM that was fine.

**Scoped to the source, and to active contacts.** A sync is a full pull, so "all
contacts from this source" is exactly this import — which makes it three indexed
counts rather than a ten-thousand-item `IN` list. Someone else's hand-added
contacts are not evidence about what GoHighLevel delivered, and an archived
contact is not going to be sent anything.

**Reusing `MISSING_ADDRESS_WHERE`** rather than writing fresh null checks, so
"postable" means the same thing here as in the contacts filter and the dashboard
"needs address" count. One definition, one place (ADR 0067).

**The summary goes amber unless everything is usable**, and names the field that
is missing:

> Imported 500 new (of 500 fetched). 12 of 500 contacts are ready to be sent a
> card — 462 without a date of birth, 480 without a postal address. Add those in
> your CRM and sync again, or fill them in on the Contacts page.

Green is reserved for an import that is both complete and usable. A number
nobody can act on is not a success.

## Consequences

- A subscriber learns at import time what their CRM is missing, in their own
  CRM's terms, rather than discovering it when cards don't arrive.
- It applies to every ingest path — CRM sync and the API-key push endpoint —
  because they share `ingestFromSource`. The same blind spot existed in both.
- Three extra counts per ingest, all indexed, against a job that already does far
  more work than that.
- 11 mutations, all caught: counting the payload instead of stored state,
  dropping either field from `sendable`, inverting the postable check, dropping
  the source scope, counting archived contacts, and four on the summary — green
  when nothing is sendable, not naming the missing fields, always naming both,
  and dropping the sentence entirely.
- `ingestResultSchema` gains a required `readiness`. Internal; no stored data
  moves.

## What this deliberately does not do

It does not refuse contacts that lack these fields. Importing them is right —
the customer may fill them in on the Contacts page, or the person may only ever
need a Christmas card. The defect was never that they arrive; it was that
nothing said they had.
