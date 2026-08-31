# 0212 — Say what the upstream said

## Status

Accepted — implemented. Not from the external review; found by investigating a
live customer's broken integration.

## Context

A GoHighLevel connection on a customer account failed every night for five
weeks. What it said, on their integrations page and in `lastSyncStatus`, was:

```
error: GoHighLevel rejected the access token
```

That sentence is true and useless. It named the status and threw the reason
away:

```ts
if (response.status === 401) {
  throw new UnauthorizedException("GoHighLevel rejected the access token");
}
```

The customer connected four times across five weeks — twice in three minutes on
one afternoon — disconnected, reconnected, and imported zero contacts. Every
attempt returned the same nine words.

The real cause was that our GoHighLevel Marketplace app was sitting
**`Disapproved`**: rejected during review, and by GoHighLevel's own description
"behaves exactly like a draft". OAuth completed fine — consent, code exchange,
tokens, locationId, all of it works for a draft app — and only the contacts call
came back 401. Nothing we stored looked wrong: valid token, unexpired, correct
location. Finding it took a database session, an audit-log trawl, and eventually
a screenshot of the GoHighLevel dashboard.

GoHighLevel almost certainly said so in the response body. We never read it.

The same omission was in all three CRM clients — HubSpot and Brevo discard their
bodies identically. `airtable-catalog-source.ts` had got this right all along,
turning a status into an actionable hint _and_ quoting the upstream, which is
the pattern this follows. One client knowing better than the others, by accident
of who wrote it, is the same shape as finding 29.

## Decision

`upstream-detail.ts`: read the error body, reduce it to one safe line, and put
it after our own summary.

**Our summary leads.** `lastSyncStatus` is stored `.slice(0, 200)`, so the half
the customer can act on has to be the half that survives truncation.

**The API's own message field wins over the envelope.** `{"message":"This app is
not authorised for this location"}` reads better than the JSON around it; the
raw body is kept when there is no recognisable field, because an unfamiliar
shape a human can read beats nothing.

**One line, capped at 120 characters.** An HTML error page or a multi-line JSON
blob is unreadable in a status field.

**Secrets are redacted by value, not by shape.** The caller passes what it sent
— the access token, the API key, the client secret — and any literal occurrence
is replaced. This matters because the body reaches two places that must never
hold a credential: the customer's integrations page, and a database column. It
is by value because a token has no distinguishing format and guessing at one is
how a leak gets missed — the same reasoning already written down in
`redact-url-tokens.ts`. Redaction runs _before_ truncation, so a secret cannot
survive by sitting at the cut.

**It never throws.** This runs on a path that is already failing. A body that
will not read must not replace the caller's real error with one about reading
it; an unreadable body simply yields the bare summary, exactly as before.

## Consequences

- The next CRM failure says why. `GoHighLevel rejected the access token — This
app is not authorised for this location` is a sentence somebody can act on.
- This does not fix the customer's sync. Nothing on our side can: the app has to
  be approved on the GoHighLevel Marketplace. What it fixes is the five weeks.
- 17 mutations, all caught: discarding the body again in each of the five call
  sites, dropping the secrets argument in each client, and every shaping rule in
  the helper — message extraction, redaction, redact-before-truncate, the cap,
  the one-line collapse, the short-secret guard, the never-throw, and the
  summary-leads ordering.
- Nothing changes on a successful sync, and no stored status is rewritten.
  Existing rows keep the bare message they were given until their next run.

## Not addressed here

Three related defects, found in the same investigation and deliberately left for
their own change:

- **The "Connected" pill is driven by a row existing, not by the connection
  working.** An integration that has never imported a contact and fails nightly
  presents as green. That is the same class as findings 5, 17, 19 and 21 — the
  UI stating something that isn't true — and it is what the customer looked at
  for five weeks.
- **A connect that returns no locationId is stored as a working connection.** It
  then fails forever, and the only remedy offered is the action that just failed.
  It should be refused at the point the customer can still act on it.
- **The locationId guard runs before `validAccessToken`**, so a connection in
  that state never refreshes and its token quietly expires. This customer's sat
  expired for three days.
