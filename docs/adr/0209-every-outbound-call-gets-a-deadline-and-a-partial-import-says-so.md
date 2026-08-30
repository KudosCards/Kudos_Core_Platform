# 0209 — Every outbound call gets a deadline, and a partial import says so

## Status

Accepted — implemented. From an external code review (finding 29 of 37).

## Context

Two separate defects, reported together because they share a cause: outbound
HTTP was written one client at a time, and nobody wrote down the rules.

### Nothing had a deadline

`fetch` has no default timeout. Every outbound call in the API was a bare
`fetch` with no `signal`, except two in the catalog code that happened to pass
`AbortSignal.timeout(...)`. That inconsistency is what makes it an oversight
rather than a decision: the same author, the same week, one call bounded and one
not. The unbounded ones included the Airtable list read that the whole nightly
catalog sync depends on, the Royal Mail shipment booking and the Click & Drop
order create — both in a request path with a customer waiting — and the
transactional email send.

The review also noted that `hintFor(429)` has always told the operator "wait a
moment and try again". No code did that. A single rate-limited page failed the
whole sync and a person had to notice and re-run it.

### A partial import reported success

Three CRM clients cap their paging loop and then simply `return all`:

| provider    | page size | cap       | contacts before it stops |
| ----------- | --------- | --------- | ------------------------ |
| HubSpot     | 100       | 50 pages  | 5,000                    |
| Brevo       | 500       | 20 pages  | 10,000                   |
| GoHighLevel | 100       | 100 pages | 10,000                   |

Airtable is the only paginated source that throws at its cap.

So a HubSpot portal with 12,000 contacts imported the first 5,000, the
connection recorded `lastSyncStatus: "ok"`, and the screen showed a green
"Imported 5,000". The other 7,000 never arrived and nothing anywhere said so —
not the UI, not the stored status, not a log line. The customer's evidence was
a number they had no reason to distrust.

Each cap carried the comment "the plan recipient cap limits what we actually
keep anyway". That is not true: `recipientCap` is nullable, and null means
unlimited. Even where a cap applies, the paging limit silently decides _which_
5,000 of 12,000 contacts the customer gets — whatever order the CRM returned
them in.

## Decision

### One way to make an outbound call

`apps/api/src/common/http-request.ts` — `httpRequest(url, init, options)`. It
owns the signal (`init` is typed `Omit<RequestInit, "signal">`, so a call site
cannot quietly take it back) and applies `DEFAULT_HTTP_TIMEOUT_MS` (15s) unless
the caller names its own. Otherwise it behaves exactly as `fetch` did: the same
response, the same throw on a transport failure, so every call site's existing
error handling is untouched.

There are no bare `fetch` calls left in `apps/api/src`, and
`common/no-bare-fetch.spec.ts` keeps it that way — it walks the source tree,
strips comments, and fails on any that reappears. That guard found a call site
this change would otherwise have missed. The one exception is
`print-pdf/image-loader.ts`, which calls an injectable `fetchImpl` seam with its
own timeout; it does not match the pattern and needs no exemption.

### Retry is opt-in, and the default is not to

`maxAttempts` defaults to 1. Blanket retry would be a worse bug than the one
being fixed: an upstream that accepted a request and then failed to answer would
be asked to do it again. So the rule is that a call may retry only if repeating
it is harmless.

| call                                        | attempts | why                                                                     |
| ------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| Airtable records, artwork download          | 4, 3     | reads; the nightly sync hangs off them                                  |
| HubSpot / Brevo / GoHighLevel contact pages | 4        | reads; one rate-limited page shouldn't lose a whole import              |
| Royal Mail tracking                         | 3        | a read on a sweep                                                       |
| Click & Drop cancel                         | 3        | delete by identifier is idempotent, and the refund has already happened |
| Brevo marketing upsert                      | 3        | `updateEnabled: true` makes it an upsert keyed on email                 |
| Royal Mail shipment, Click & Drop order     | 1        | a retry books a second card into the post                               |
| Brevo transactional email                   | 1        | a retry puts a second copy in someone's inbox                           |
| HubSpot / GoHighLevel token exchange        | 1        | codes are single-use and refresh tokens rotate                          |

Retryable means 429 or 5xx — a 4xx will fail again identically. `Retry-After` is
honoured in both its delta-seconds and HTTP-date forms, because an upstream that
tells us when it will serve us again knows better than our backoff does;
otherwise the delay doubles from 500ms. Either way it is capped at 30s, so a
nightly sync still finishes tonight.

### Truncation is carried, not swallowed

`fetchContacts` on all three CRM clients now returns
`CrmContactsResult<T> = { contacts, truncated }` instead of a bare array.
`truncated` is true only when the cap ended the run with the provider still
offering more — a run that ends because the list ran out is complete even if it
used every allowed page.

The service carries it through to `CrmSyncResult.truncated`, logs a warning, and
stores a status that is deliberately not "ok":

> partial: stopped at the provider page limit after 5,000 contacts — some were
> not imported

The connections list renders any non-"ok" status verbatim, so that reaches the
customer with no further work. The sync summary on the integrations screen turns
amber and says what happened and what to do about it.

The caps themselves are unchanged. They are doing their job — one enormous
account must not hold the nightly sweep open — and moving them is a separate
decision from telling the truth about them.

## Consequences

- A partial CRM import now shows amber on screen, records a partial status on
  the connection, and logs a warning. Existing connections keep whatever status
  they last stored until their next sync.
- `crmSyncResultSchema` gains a required `truncated`, and the three client
  interfaces changed shape. Both are internal; no stored data moves.
- Two existing Click & Drop cancel tests are ~1.5s slower, because the failure
  paths they cover now retry. That is the change working.
- The specific timeout and attempt counts are pinned by tests at the call sites
  that matter, via a spy on `AbortSignal.timeout` where the value would
  otherwise be unreadable.
- Nothing here changes what a _successful_ sync does. A customer whose address
  book fits under the cap sees exactly what they saw before.

## Alternatives considered

**Throw at the cap, as Airtable does.** Consistent, and wrong for this case: a
12,000-contact portal would then import nothing at all. A partial import that
says it is partial serves the customer better than a clean failure.

**Retry everything.** Rejected above — it turns a timeout into a duplicate
posted card.

**Raise the caps.** Doesn't fix anything; it moves the silent cliff to a larger
number. Worth revisiting once we know from the logs how often a real account
reaches one.
