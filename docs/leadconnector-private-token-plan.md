# LeadConnector: connecting with the customer's own token

**Status:** P1–P5 built and merged — see ADR 0253. The two problems in [Two existing problems](#two-existing-problems-this-sits-on-top-of) are still open, and so is the live failure the decisive test below settles.

A LeadConnector (HighLevel / GoHighLevel) customer should be able to paste a
token they generated themselves and have their contacts sync nightly, exactly as
a Brevo or CleanCloud customer does today. This is the plan for that, and for
two problems with the existing LeadConnector integration that this work sits on
top of.

## Evidence quality — read this first

`marketplace.gohighlevel.com`, `help.gohighlevel.com` and `highlevel.stoplight.io`
are **all blocked by this environment's egress proxy**, exactly as
`cleancloudapp.com` was. Every factual claim below comes from web search results
quoting those pages, not from reading them.

That is a weaker basis than the CleanCloud work had, and it is flagged at each
claim as **[confirmed]** (consistent across several independent sources and
matching how our existing OAuth client already works in production) or
**[reported]** (one or two search results, worth checking before it is relied
on). Nothing here should be built against a **[reported]** claim without opening
the page first.

## What a Private Integration Token is

HighLevel's answer to "I want an API key, not an OAuth app".

- A sub-account admin opens **Settings → Private Integrations** inside their
  sub-account, names the integration, ticks the scopes they want (for us,
  `contacts.readonly`), and copies the token once. **[confirmed]**
- It is long-lived and does not auto-refresh — "essentially a static OAuth2
  access token". **[confirmed]**
- It is used exactly like an OAuth access token: `Authorization: Bearer <token>`
  plus the `Version: 2021-07-28` header. **[confirmed]**
- Reported prefix is `pit-` in one source and `pit_` in another, about 40
  characters. **[reported]** — and a good reason **not** to validate on the
  prefix. We check a token by using it, not by looking at it.

### Why this is worth doing

**The Marketplace app has a hard ceiling, and we are under it.**

The Kudos Cards app exists and is working — Marketplace ID
`6a7b05c62a9e0d6314e01596`, version 1.0.0, created 11 August 2026, status
**Live**. Its distribution type is **Private**.

HighLevel's Developer Policy for Private App Distribution Limits, which applies
to private apps created on or after **18 November 2025**, says: **[confirmed]**

> A private app may be installed in up to 5 Agencies. At 6 or more Agencies, new
> installs are blocked.

with one clarification that matters a great deal here:

> One Agency equals one count, regardless of how many Sub-accounts are installed.

Our app was created nine months after that policy date, so it is squarely inside
it. Existing installs keep working; it is _new_ installs that stop.

What that means in practice depends entirely on the shape of our customer base,
which is a question for the business rather than the code:

- If LeadConnector customers arrive as **sub-accounts under a handful of
  agencies**, the cap is not close to binding — sub-accounts are unlimited.
- If they arrive as **independent agencies**, the sixth one cannot install. There
  is no error we can write, no retry, and no code change that gets past it.

The two documented escapes are to publish the app publicly, which means a
Marketplace review — the one that rejected our listing over white-labelling (ADR 0234) — or to request a Security Review, available only once the cap has already
been hit, which lifts it while keeping the app private. **[confirmed]**

**A Private Integration Token is subject to none of this.** The customer creates
it inside their own sub-account; no Marketplace app is involved, so no
distribution cap applies. That moves this work from a convenience to the route
that actually scales, and it is why the token lane should be the LeadConnector
card's primary action rather than its alternative.

### Why it is also simply better for the customer

The OAuth lane needs a HighLevel Marketplace app, and HighLevel has to approve
it. A Private Integration needs nothing from HighLevel and nothing from us: the
customer creates it in their own sub-account. It removes an approval dependency
from the critical path of every LeadConnector customer.

## The thing that makes this more than a copy of the CleanCloud work

**`locationId` is required on every contacts call, and a token does not tell us
what it is.** **[confirmed]** Contacts, opportunities, conversations and
calendars are all sub-account-scoped, and the id goes in the request.

There is no documented way to derive it from a Private Integration Token:

- The OAuth token exchange returns `locationId` in the token response — which is
  exactly how our existing OAuth lane populates `externalAccountId`. A Private
  Integration has no token exchange to return it. **[confirmed]**
- `GET /oauth/installedLocations` is for a Marketplace app's company token, not
  for a Private Integration. **[confirmed]**
- Nothing found suggests a PIT is a decodable JWT carrying its own location.
  **[reported, weakly]** — and decoding an undocumented token format would be a
  guess with a silent failure mode, so it is out regardless.

**So the connect form asks for two things: the token and the Location ID.** That
is a real UX cost and there is no way around it. Two things make it bearable:

1. **`CrmConnection.externalAccountId` already exists** and already holds exactly
   this value for the OAuth lane. No migration.
2. **Accept a pasted URL as well as a bare id.** People find their Location ID in
   their own dashboard URL — `app.gohighlevel.com/v2/location/<id>/...` — and the
   documented instruction is literally "look at the URL after `/location/`".
   A field that takes either the id or the whole pasted URL removes the one step
   most likely to go wrong. Same spirit as the CleanCloud address parser, and as
   testable.

### Verify both together, before storing either

`verifyKey` does one `GET /contacts/?locationId=<id>&limit=1`. That proves three
things at once: the token is real, the location exists, and **the token is scoped
to that location**. Paste a good token with the wrong Location ID and you get an
immediate, specific error rather than a connection that looks healthy and imports
nothing every night for a week.

This also handles the agency-token case for free. An agency-level Private
Integration is not scoped to a sub-account, so it fails this check and is refused
at connect time — the same defect `UnusableGrantException` exists to catch on the
OAuth lane, caught the same way but earlier.

## How little code this needs

The useful surprise: **a Private Integration Token is used identically to an OAuth
access token**, so `HttpGoHighLevelClient.fetchContacts(accessToken, locationId)`
already works with one, verbatim. The paging loop, the `nextPageUrl` cursor, the
fetch budget, the `truncated` contract, the mapper, the scheduler and the ingest
funnel all stay exactly as they are.

What actually changes:

### P1 — Two auth lanes for one provider

`CRM_PROVIDERS` carries one `authType` per provider, and `connect()`,
`startOAuth()` and `completeOAuth()` compare it with `===`. LeadConnector needs
both lanes, so that field becomes a set — `authTypes: ["oauth", "api_key"]` —
and those three comparisons become membership tests.

`CrmConnection` already has an `authType` column and `@@unique([accountId,
provider])`, so a customer has one LeadConnector connection at a time and the row
records which way they connected. `fetchGoHighLevelContacts` branches on that:
`api_key` decrypts `encryptedApiKey` and skips the refresh dance entirely;
`oauth` keeps `validAccessToken`. Nothing else in the sync path knows the
difference.

### P2 — A second field on the connect form

`ConnectCrmDto` gains an optional `externalAccountId` (bounded, trimmed), and
`connect()` requires it exactly when `CRM_PROVIDERS[provider].needsExternalAccount`
is true — a flag LeadConnector already carries. `parseLocationId` accepts a bare
id or a pasted dashboard URL, and rejects anything that is neither rather than
storing a fragment.

### P3 — `verifyApiKey` gains a case

The dispatch added with CleanCloud gets a `gohighlevel` arm calling the one-contact
check above. It needs the location id, so the signature widens from
`(provider, apiKey)` to `(provider, apiKey, externalAccountId)`.

### P4 — UI

`ApiKeyConnector` (generalised in the CleanCloud work) gains an optional second
field, described by props the way `mappingFields` already is. The LeadConnector
card then offers both routes: "Paste a token" and "Connect with LeadConnector",
with the token route first — it works today and does not depend on an approval.
The card must keep using `crmProviderLabel("gohighlevel")`; the white-label rule
in ADR 0234 is unchanged.

### P5 — Tests + ADR

Unit: `parseLocationId` (bare id, pasted URL with and without a trailing path,
query string, rubbish). Client: the PIT lane sends `Authorization: Bearer` and
`Version`, and never leaks the token into a stored status. E2e: connect with
token + location → sync → contacts land as `source=gohighlevel`; a wrong location
is refused at connect; an OAuth connection and a token connection cannot both
exist for one account. ADR recording why two lanes rather than a replacement.

## Two existing problems this sits on top of

Both affect the OAuth lane that is live today, not just the new one. Both are
worth doing and **neither is in scope for P1–P5** unless you say so.

### A. `GET /contacts` is reported deprecated

Search results state the endpoint our client uses has been deprecated in favour
of `POST /contacts/search`, which pages on a `searchAfter` cursor rather than
`meta.nextPageUrl`. **[reported]** — one clear statement, not corroborated, and
our client is working in production today.

If it is true, this is a real countdown on the whole LeadConnector integration
and the migration is a focused piece of work: the same paging loop, a POST body
instead of query parameters, `searchAfter` instead of `nextPageUrl`. Reported page
sizes differ between sources (20 in one, 100 in another), which is itself a
reason to read the page before writing the loop.

**This needs one look at the primary docs before anything is decided.**

### B. We do not pace against the published rate limit

HighLevel publishes **100 requests per 10 seconds** burst and **200,000 per day**,
per app per location, and returns `X-RateLimit-Remaining` and
`X-RateLimit-Max` headers on every response. **[confirmed]**

`GOHIGHLEVEL_MAX_PAGES = 100` at 100 contacts a page means a large location can
fire up to 100 requests as fast as the network allows — straight through the
burst limit. Today `httpRequest` only reacts _after_ a 429, by honouring
`Retry-After`, so the sync recovers rather than failing. It works; it is also us
leaning on the retry to do a job pacing should be doing, and it burns budget the
customer's other integrations share.

The fix is small and belongs in the client: read `X-RateLimit-Remaining` and
sleep when the window is nearly spent. Worth pairing with A, since both touch the
same loop.

## The live failure: "Location is not active"

A connected account shows, on clicking Sync now:

> LeadConnector rejected the access token — Location is not active

Those last four words are **HighLevel's, not ours**. Our client wraps a 401 from
the contacts call as `LeadConnector rejected the access token` and appends
whatever the upstream body said (ADR 0212). So the upstream sentence is
"Location is not active".

### What that rules out

Reading our own code, the request that produced it was structurally sound:

- `externalAccountId` was present — had it been null, `fetchGoHighLevelContacts`
  would have thrown the "this connection is to an agency" message instead, and
  never reached HighLevel.
- The token was current — `validAccessToken` refreshes anything inside the
  expiry buffer before the call goes out.
- The headers are right: `Authorization: Bearer`, `Version: 2021-07-28`.

So this is not a malformed request, an expired token, or a missing location id.

More usefully, it is **not a credentials problem at all**. A credentials problem
says "invalid token" or "the token does not have access to this location" — both
are messages HighLevel demonstrably uses. "Location is _not active_" is a
statement about the state of the sub-account.

**Which means reconnecting cannot fix it**, and reconnecting is the obvious
instinct and almost certainly what has been tried repeatedly. Every reconnect
mints a valid token for a location that is still not active, and fails
identically. That is the same shape of trap as the "please reconnect it" wording
ADR 0213 already fixed once: advice to repeat the action that just failed.

### The decisive test, which takes two minutes

Create a **Private Integration Token** in the affected sub-account
(Settings → Private Integrations, scope `contacts.readonly`) and call the
contacts endpoint directly with it:

```
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://services.leadconnectorhq.com/contacts/?locationId=<LOCATION_ID>&limit=1' \
  -H 'Authorization: Bearer <PRIVATE_TOKEN>' \
  -H 'Version: 2021-07-28'
```

- **Same "Location is not active"** → the sub-account's state at HighLevel is the
  problem. Nothing in our code, our Marketplace app, or our OAuth flow is
  involved, and no change to any of them will help. It is fixed in HighLevel or
  by pointing at a different sub-account.
- **It works** → the problem is specific to our Marketplace app's install on that
  location, and the token lane in this plan unblocks that customer immediately.

Either answer is actionable, and the token created to get it is the same artefact
P1 needs to be verified against. One action, three answers.

### Three things to check in HighLevel alongside it

1. **Is the Kudos Cards app actually installed on that sub-account?** Not on the
   agency — on the sub-account itself. A grant obtained through the
   `chooselocation` screen is not the same thing as an install landing on that
   location, and "not active" is a plausible way for HighLevel to describe the
   difference.
2. **What state is the sub-account in?** Paused, trial-expired, or created from a
   snapshot and never activated would each fit the words exactly.
3. **Which location id are we actually calling?** We hold it and never show it,
   so this has been debugged blind. See below.

### A small change worth making regardless

The integrations page shows the error but not the sub-account it refers to. The
location id is not a secret — it is in the customer's own dashboard URL — and
showing it on a connected LeadConnector card turns "it says not active" into "it
says _this_ sub-account is not active", which is the difference between guessing
and checking. Small, and it would have shortened this.

### Has this lane ever worked against a real HighLevel account?

Worth asking plainly, because the answer changes how much to trust the client
code. Every LeadConnector test in the suite runs against a mock — that is
deliberate and correct, and it means the paging loop, the cursor handling and the
field mapping have never been exercised against the real API. Brevo, HubSpot and
now CleanCloud are in the same position by design; the difference is that this
one has a live failure in front of it.

If the answer is "no, never", then this is not a regression to bisect but a lane
that has not yet had its first successful call — and the token route is the
quickest way to get one.

## What I would want confirmed before building

1. **How do LeadConnector customers reach us — as agencies, or as sub-accounts
   under a few agencies?** Answered, this says whether the 5-agency cap is a
   live problem today or a distant one. It does not change the plan either way,
   because the token lane sidesteps the cap entirely; it changes how urgent this
   is. (The app itself is settled: Private, Live, created 11 August 2026.)
2. **One look at `GET /contacts` in the docs** to settle whether it is deprecated,
   and at `POST /contacts/search` if it is.
3. **One real Private Integration Token against one real sub-account** — the same
   ask as CleanCloud, and for the same reason. It would settle the token prefix,
   confirm the token works against `GET /contacts/?locationId=`, and show what a
   wrong-location failure actually returns so the error message can name it.

None of the three blocks writing P1–P5. All three would stop us shipping
something that is merely plausible.
