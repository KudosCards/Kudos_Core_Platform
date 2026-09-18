# CleanCloud integration plan

**Status:** built. Phases N1–N5 are implemented and tested; see
[What shipped](#what-shipped) for where each decision landed and
[ADR 0252](adr/0252-a-birthday-with-no-year.md) for the reasoning. One fact is
still outstanding — the live date-range response shape — and is handled
defensively rather than guessed; see [Still outstanding](#still-outstanding).

## Why this integration

CleanCloud is the point-of-sale and CRM used by dry cleaners and laundries. A
CleanCloud operator already holds the two things a Kudos card needs and that
most CRMs do not have: a **real postal address** (they collect and deliver to
it, so it is kept accurate as an operational necessity, not as a marketing
nicety) and a **birthday** (day and month, captured at sign-up).

That makes it a better contact source than the email-marketing CRMs we already
support, not merely another one.

## What a customer gets

A Kudos account holder who uses CleanCloud opens **Integrations**, pastes their
CleanCloud API token, and their customer list is imported as Kudos contacts —
then re-imported every night at 05:00 by the existing `CrmSyncScheduler`, with
no further action from them. Exactly the Brevo experience, with better data.

## What the platform already gives us for free

This is deliberately a small integration, because the spine exists:

| Piece                                     | State                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Credential storage                        | `CrmConnection.encryptedApiKey` + `authType` already exist. **No migration.**                          |
| Connect / disconnect / sync-now endpoints | `POST /integrations/connections`, `.../:provider/sync`, `DELETE .../:provider` are provider-generic.   |
| Nightly sweep                             | `CrmSyncScheduler` walks every enabled connection. Nothing to add.                                     |
| Ingest funnel                             | `RecipientsService.ingestFromSource` upserts on `(accountId, source, externalId)`.                     |
| Partial-pull honesty                      | `CrmSyncResult.truncated` + `unmappable`, surfaced in `lastSyncStatus`.                                |
| "Can we actually post to these?"          | `readinessFor` reports `total / withDateOfBirth / withPostalAddress / sendable` per source.            |
| Birthday scheduling                       | `nextBirthdayOccurrence` reads only `getUTCMonth()` / `getUTCDate()` — a birth **year is never used**. |

Adding a provider is, by design, a registry entry + a client + a mapper.

## The API, as far as the published documentation goes

- Base: `POST https://cleancloudapp.com/api/<method>`, `Content-Type: application/json`.
- Auth: `api_token` **in the JSON body** — not a header. Maps to our `api_key`
  auth type; no OAuth app, no redirect URI, no env vars, no Railway change.
- Read method: `getCustomer`, either `customerID` (one customer) **or**
  `dateFrom` / `dateTo` (a range), plus `excludeDeactivated`.
- Verbatim from the docs: _"Note that the response is structured differently if
  you are requesting customers by date range. Date Range is also limited to 31
  days."_
- Fields of interest: `customerID`, `customerName` (one field), `customerAddress`
  (one free-text field), `customerEmail`, `birthdayDay`, `birthdayMonth`.

### No updated-at filter

`getCustomer` filters on the customer's **creation** date, not last-modified.
There is therefore no incremental sync: a customer who changes address today
would never reappear in a "since yesterday" window.

The answer is to stop trying. At 31 days per request, a **full ten-year
re-walk is ~118 requests** — trivial for a nightly job, and it makes address
edits and deactivations propagate. So: full re-walk every night, oldest window
first, with a contact cap and `truncated` set honestly when the cap bites.

## The three mapping problems (the actual work)

Everything above is plumbing. These are the decisions.

### 1. One `customerName`, and we require two names

`externalContactSchema` requires `firstName` **and** `lastName`, both
`min(1)`. `deriveContactName` splits on the **last** whitespace, which is the
right rule ("Mary Anne Clarke" → "Mary Anne" / "Clarke").

A **mononym** ("Yusuf", a business name like "Flat 4") has no last name and
would be dropped as `unmappable`. That count is reported, so the customer sees
it — but silently losing contacts is a poor first impression.

**Decision needed.** Options: (a) drop, and rely on the `unmappable` count;
(b) mirror the name into both fields; (c) put the whole string in `firstName`
and a single placeholder in `lastName`. Recommendation: **(a) drop, but name
the count in the UI** — a card addressed to "Yusuf Yusuf" is worse than a card
not sent, and the readiness panel already has somewhere to say so.

### 2. One free-text `customerAddress`, and we need a postcode

`MISSING_ADDRESS_WHERE` treats a contact as unpostable unless `addressLine1`,
`addressCity` **and** `addressPostcode` are all non-empty. CleanCloud hands
over a single string.

- `ukPostcodeRegex` in `packages/shared-types/src/recipient.ts` is **anchored**
  (`^...$`) — it validates a field, it cannot find a postcode inside a sentence.
  This needs an **unanchored companion** exported alongside it, not a change to
  the existing one (it is used as a validator elsewhere).
- Parse strategy: find the postcode (last match wins — addresses end with it),
  take the text after the last comma before it as the city, and the remainder
  as line 1/2.

**Correcting an earlier statement of mine:** I said a missing postcode would
break dedupe. It does not. `recipients_account_id_first_name_last_name_address_postcode_key`
is a plain `CREATE UNIQUE INDEX`, so Postgres treats NULLs as **distinct** —
rows with a NULL postcode never collide. The real consequence is milder and
different: for those rows that index simply stops de-duplicating. Since the
ingest keys on `(accountId, source, externalId)` and CleanCloud's `customerID`
is stable, per-source dedupe is unaffected either way.

The genuine consequence of a failed address parse is that the contact imports
but is **not postable** — and `readinessFor` already reports exactly that as
`withPostalAddress` vs `total`. The integration stays honest by construction;
the work is making the parse good enough that the number is high.

### 3. `birthdayDay` + `birthdayMonth`, with no year

Scheduling is fine — verified: `nextBirthdayOccurrence` never reads the year.
Display is not. `dateOfBirth` is a full `DateTime`, and
`recipients-client.tsx` renders it with `toLocaleDateString("en-GB")` in three
places (table, detail, **CSV export**). Storing a placeholder year would show
customers a birth year that is a lie, and export it.

**Decision needed.** Options: (a) a documented sentinel year plus a display
helper that prints day/month only when the year is the sentinel; (b) a nullable
`birthYear` column and a schema change. Recommendation: **(a)** — it is a
display concern, not a data-model one, and it does not migrate the table.

### And one non-problem

CleanCloud needs **no field mapping**. Its fields are fixed by the product,
unlike Brevo/HubSpot where the customer names their own attributes. The
`fieldMapping` column stays NULL and the UI shows no mapping step.

## What shipped

| Phase | Where                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------- |
| N1    | `cleancloud/cleancloud-client.ts`, `http-cleancloud-client.ts`, `cleancloud-windows.ts`, `cleancloud-response.ts` |
| N2    | `cleancloud/cleancloud.mapper.ts`, `parse-address.ts`, `shared-types/birthday.ts`, `findUkPostcode`               |
| N3    | `CRM_PROVIDERS.cleancloud`, `fetchCleanCloudContacts`, `verifyApiKey`, `birthYearKnown` through the ingest        |
| N4    | `ApiKeyConnector` (Brevo's connector, generalised) + the CleanCloud card                                          |
| N5    | `test/cleancloud.e2e-spec.ts`, ADR 0252                                                                           |
| N6    | Not started — out of scope until this is running against a live token.                                            |

### The four decisions, as taken

1. **Mononyms are dropped** and counted as `unmappable`, which the customer can
   see. "Dear Yusuf Yusuf" and an invented surname were both worse.
2. **A placeholder year plus an explicit `birthYearKnown` column.** The sentinel
   alone does not work in either direction — outside the 120-year window the API
   refuses to save the contact; inside it, it hides the real birth year of every
   customer who has one. One `BOOLEAN NOT NULL DEFAULT true` column, no backfill.
3. **Ten years of history**, walked newest window first, ~118 requests a night.
4. **Read-only.** Nothing is written back to CleanCloud.

### Two corrections to the plan above

- **A missing postcode does not break dedupe.** The recipient dedupe index is a
  plain `CREATE UNIQUE INDEX`, so Postgres treats NULLs as distinct and those
  rows never collide. The real consequence is that the contact imports but is
  not postable, which `readinessFor` already reports.
- **Windows run newest first, not oldest first.** A pull that stops early should
  hold the people who signed up most recently, not the oldest tenth of the list.

## Still outstanding

1. **One real `getCustomer` date-range response, as JSON.** The published docs
   show the single-customer shape and state that the range shape differs, but do
   not print it. Rather than guess, `extractCustomers` accepts every shape that
   sentence could mean and throws naming the top-level keys it actually got when
   none fits — so the first live call either works or produces a one-line fix.
   `cleancloudapp.com` is blocked by this environment's egress proxy.
2. **Rate limits.** Not published. The retry honours `Retry-After` with
   exponential backoff behind it, which is the right behaviour whatever the
   limit turns out to be.
3. **Bad-token behaviour.** `verifyKey` treats 401 and 403 as a rejected token
   and everything else as an upstream failure; if CleanCloud signals a bad token
   some third way, that mapping is one line.

None of the three blocks the code. All three are worth confirming on the first
live connection.
