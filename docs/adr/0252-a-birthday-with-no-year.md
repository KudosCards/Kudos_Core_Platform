# 0252 — A birthday with no year

## Status

Accepted

## Context

CleanCloud is the point-of-sale and CRM that dry cleaners and laundries run on.
It is a better contact source for this platform than the email-marketing CRMs we
already read, for a reason that is structural rather than incidental: an
operator who collects and delivers keeps a **real postal address** because the
business depends on it, and captures a **birthday** at sign-up. Those are the
two things a posted birthday card needs, and the two things a mailing list
usually lacks.

Almost all of the integration was already built. `CrmConnection` carries
`encryptedApiKey` and `authType`; the connect, sync and disconnect endpoints are
provider-generic; `CrmSyncScheduler` walks every enabled connection nightly; and
`ingestFromSource` upserts on `(accountId, source, externalId)`. Adding a
provider is a registry entry, a client and a mapper.

What was not already solved is that three of CleanCloud's fields do not fit
ours, and one of them does not fit the database.

### The API

`POST https://cleancloudapp.com/api/getCustomer`, with `api_token` in the JSON
body rather than a header. Either one `customerID`, or a `dateFrom`/`dateTo`
range. From the documentation, verbatim:

> Note that the response is structured differently if you are requesting
> customers by date range. Date Range is also limited to 31 days.

It then prints the single-customer shape and not the range one.

`getCustomer` filters on the customer's **creation** date. There is no
last-modified filter of any kind.

## Decision

### Re-walk the whole history every night, newest window first

No last-modified filter means there is no such thing as an incremental sync
here: a customer who changed address today would never appear in a "since
yesterday" window. So we stop trying. At 31 days a request, a decade is about
118 requests — nothing for a nightly job, and it makes address edits and
deactivations actually propagate.

Windows run newest first. That only matters when a pull stops early, and then it
matters a great deal: whoever signed up most recently is who the customer is
most likely to be looking for, and a partial import holding the oldest tenth of
the list would look like the integration had simply lost people. Stopping early
is reported as `truncated`, as everywhere else (ADR 0227, ADR 0231).

### Read the response envelope tolerantly, and fail loudly when we cannot

The documentation says the range response differs and does not say how. The
answer to that is not to guess one envelope and hope. `extractCustomers` accepts
every shape the sentence could reasonably mean — a bare array, a list under any
of several names, an object keyed by customer id, a single customer — and when
none of them fits, throws naming the top-level keys that actually arrived.

The asymmetry is the point. A wrong guess that returns an empty list makes the
sync report "0 contacts, ok" for ever, and nobody learns why. A wrong guess that
says `CleanCloud returned an unrecognised response (keys: …)` is a one-line fix
after the first live call.

### A mononym is dropped, not padded

`customerName` is one field. We split on the last whitespace, as
`deriveContactName` already does. A name with no whitespace — a mononym, or a
business trading name in the customer field — is dropped and counted as
`unmappable`, which the customer can see.

The alternatives are worse: "Dear Yusuf Yusuf", or an invented surname printed
on an envelope. A contact we cannot address is better not sent than sent wrong.

### The town comes from a comma, never from the last word

`customerAddress` is one free-text field. We find the postcode (an unanchored
companion to `ukPostcodeRegex`, built from the same pattern string so the two
cannot drift), drop anything after it, and split what remains on commas and line
breaks: first part is line 1, last part is the town, anything between is line 2.

Where there is no comma, the town comes back null. Taking the word before the
postcode would turn "12 Acacia Avenue SW1A 1AA" into the town "Avenue", which
looks right on a screen and is wrong on an envelope. A null is honest, and
`readinessFor` already reports `withPostalAddress` against `total`, so the
customer sees how many need finishing.

### A birthday with no year gets a placeholder and a flag that says so

CleanCloud captures `birthdayDay` and `birthdayMonth` and never asks for a year.
That is enough to send a card — `nextBirthdayOccurrence` reads only the month
and the day — but `Recipient.dateOfBirth` is a `DATE`, so something has to go in
the year.

Inferring "no year" from a magic year value was considered and rejected twice
over:

- A magic year **outside** the plausible range (1600) is refused by the API's own
  `MinDate` bound of `MAX_AGE_YEARS`. The contact would import and then be
  impossible to edit — the form would not save.
- A magic year **inside** it (2000) is indistinguishable from a real 26-year-old.
  We would hide the true birth year of every customer who has one, including in
  the CSV export.

So the fact is recorded explicitly. `Recipient.birthYearKnown` is a `BOOLEAN NOT
NULL DEFAULT true` — no backfill, no behaviour change for any existing row — and
`BIRTHDAY_PLACEHOLDER_YEAR` becomes an implementation detail with two load-bearing
constraints: it is a **leap year**, so 29 February does not roll into 1 March and
move somebody's card; and it is **inside** the 120-year window, so the edit form
and the update DTO accept it.

Every screen that shows a date of birth goes through `formatBirthDate`, which
omits the year rather than printing a placeholder: "14 March", not "14 March
2000".

### A yearless source may correct the day, but may not overwrite a year

"Merge, don't clear" covers a source that carries nothing. A source that carries
a day and month but no year is a third case, and the naive answer is wrong:
CleanCloud hands back the same placeholder every night, and would stamp out a
real birth year the customer had since typed in — for ever, and visibly, once a
day.

So `birthdayUpdate` lets a yearless source fill an empty birthday and correct a
day or month, but where the day and month already agree with a date that has a
real year on it, it leaves that date alone. The source is authoritative about
_which day_; it never claimed to know the year.

The matching rule on the way in: `update()` sets `birthYearKnown` back to true
only when the submitted date actually **differs** from the stored one. The edit
form posts every field on every save, so flipping the flag whenever
`dateOfBirth` is present would turn opening the page and pressing Save into an
assertion that the placeholder year is real.

### No field mapping, and the connect path now asks the right provider

CleanCloud's fields are fixed by the product, unlike Brevo's custom attributes or
HubSpot's properties, so `CRM_PROVIDERS` gained `configurableFields: false`:
there is no mapping step in the UI, and a mapping sent anyway is refused rather
than stored where nothing reads it.

Connecting also used to verify **every** api_key connection against Brevo. With
one api_key provider that was invisible; with two it would have rejected every
valid CleanCloud token. `verifyApiKey` now dispatches on the provider.

## Consequences

- A dry cleaner pastes one API token and gets their customer list, with
  addresses and birthdays, refreshed nightly.
- Contacts whose address does not parse still import, and are counted as not yet
  postable rather than silently dropped.
- The first live call against a real date-range response either works or names
  the keys it got. Nothing is written against a guessed envelope.
- One new column, defaulted, with no backfill.
- This integration only ever reads. Nothing is written back to CleanCloud.

## Still open

The published documentation does not print the date-range response shape, and
does not publish a rate limit. Both are handled defensively rather than assumed:
the envelope is read tolerantly and diagnosed loudly, and the retry honours
`Retry-After` with exponential backoff behind it. A single real response would
let us narrow `extractCustomers` from "several plausible shapes" to "the one
shape it is".
