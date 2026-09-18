# CleanCloud integration plan

**Status:** plan only — nothing implemented. One fact is still missing (see
[Blocked on](#blocked-on)) and the mapper cannot be written honestly without it.

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

## Phases

- **N1 — client.** `cleancloud/cleancloud-client.ts` (interface + Symbol token),
  `http-cleancloud-client.ts`: 31-day windowing, page/contact cap, request
  budget, `truncated`. `verifyKey` = a single one-day window, so connecting
  fails fast on a bad token.
- **N2 — mapper.** `cleancloud.mapper.ts`: name split, address parse, birthday.
  The risk lives here; it gets the mutation-tested unit suite.
- **N3 — wiring.** `CRM_PROVIDERS.cleancloud = { authType: "api_key",
needsExternalAccount: false }`, a `fetchCleanCloudContacts` case, label
  entries (the `no-whitelabel-breach` guard requires them).
- **N4 — UI.** A `CleanCloudConnector` beside `BrevoConnector` in
  `integrations-client.tsx` (that component hardcodes `"brevo"`, so it is a
  sibling, not a parameterisation — unless N4 generalises it, which is the
  cleaner option if a fourth api_key provider is ever likely).
- **N5 — e2e + ADR.** Connect → sync → readiness, against a stubbed client;
  ADR recording the full-re-walk decision and the birthday-year decision.
- **N6 — optional.** `getOrders` for lapsed-customer occasions ("we haven't
  seen you in six months"). Out of scope until N1–N5 ship.

## Blocked on

1. **One real `getCustomer` date-range response, as JSON.** The published docs
   show the single-customer shape and state that the range shape differs, but
   do not print it. Writing the client against a guessed envelope is exactly
   the shortcut this project does not take. `cleancloudapp.com` is blocked by
   this environment's egress proxy, so it cannot be fetched from here.
2. **Rate limits** (Getting Started page) — the only remaining unknown that
   could change the design rather than just the code.
3. **Bad-token behaviour** — HTTP status and body, so `verifyKey` can tell
   "wrong key" from "CleanCloud is down".

## Decisions for the account owner

1. Mononyms: drop (recommended) or synthesise a surname?
2. Birthday year: sentinel + display helper (recommended) or nullable column?
3. First-sync horizon: how far back does the initial re-walk go — all history,
   or the last N years?
4. Read-only confirmed: this integration never writes to CleanCloud.
