# 0253 — A second way into LeadConnector

## Status

Accepted

## Context

LeadConnector has connected by OAuth since ADR 0156: the customer is sent to a
consent screen, picks a sub-account, and we store the tokens that come back.
That works, and it keeps working. It also has a ceiling we cannot raise from
here.

Our Marketplace app — Kudos Cards, created 11 August 2026 — is **Live** and of
distribution type **Private**. HighLevel's Developer Policy for Private App
Distribution Limits, which applies to private apps created on or after
18 November 2025, says a private app may be installed in **at most five
agencies**; at six or more, new installs are blocked. Existing installs keep
working. One agency counts once however many of its sub-accounts install, so
whether the ceiling binds depends on how our customers arrive — as agencies, or
as sub-accounts under a few of them.

No code change lifts it. The two documented escapes are to publish the app
publicly, which means the Marketplace review that rejected our listing over
white-labelling (ADR 0234), or to request a Security Review, which only becomes
available once the cap has already bitten.

Separately, a connected account has been failing every sync with:

> LeadConnector rejected the access token — Location is not active

Those last four words are HighLevel's; our client appends the upstream body to
its own 401 wrapper (ADR 0212). They are a statement about the **sub-account**,
not the credential — HighLevel says "invalid token" or "the token does not have
access to this location" when it means those. So reconnecting cannot fix it, and
reconnecting is the obvious instinct.

## Decision

### Two auth lanes for one provider, not a replacement

`ProviderTraits.authType` becomes `authTypes`, a list. LeadConnector carries
`["oauth", "api_key"]`; everything else carries one.

A **Private Integration Token** is created by the customer inside their own
sub-account (Settings → Private Integrations, scope `contacts.readonly`) and
needs no Marketplace app, so the distribution cap does not reach it. It is the
route that scales, and it is the primary action on the card. OAuth stays,
because existing connections must keep working and some customers will prefer
it.

`CrmConnection.authType` already records how a given connection was made, and
`@@unique([accountId, provider])` keeps it to one at a time. Reconnecting one
way clears the other's credentials rather than leaving them beside it.

`supportsAuthType()` exists because the registry is `as const`: each entry's
`authTypes` is a tuple of literals, so `.includes()` narrows its own argument to
those literals, and asking a single-lane provider about the other lane stops
compiling — the opposite of what a capability check is for.

### The sub-account is asked for, because nothing else can supply it

Every contacts call carries a `locationId`. An OAuth token exchange returns it;
a pasted token does not, and nothing documented turns one into the other —
`/oauth/installedLocations` is for a Marketplace app's company token. So the
customer supplies it, in a second field. There is no way around that.

`CrmConnection.externalAccountId` already holds exactly this value for the OAuth
lane, so there is no migration.

`parseLocationId` takes the bare id **or the whole dashboard address it was
copied from**, because the one place the customer is told to find it is their
own URL bar. Asking for "the bit after `/location/`" and then refusing the
address it came from is how a two-minute setup becomes a support thread.

Its shape check is deliberately loose — length, and the characters that survive
a URL path segment. Every id seen in the wild is alphanumeric and it was
tempting to write that down; a fixture in our own test suite (`loc-abc-123`)
is what made the point that a rule tighter than the provider's own turns a
working id into a refusal we invented. It cannot be checked against HighLevel's
documentation from here, and the next paragraph does the real work anyway.

### Verify the token against the sub-account, before storing either

`verifyToken` reads one contact from the named sub-account. That proves three
things at once: the token is real, the sub-account exists, and **the token is
scoped to it**.

The customer is pasting two values found in two different places, so a good
token with the wrong sub-account is the likely mistake — and stored, it is
indistinguishable from a working connection until 5am the next morning. This
also catches an agency-level token, which is the defect
`UnusableGrantException` exists to catch on the OAuth lane, caught earlier and
more cheaply.

A sub-account with no contacts in it passes. The question asked is whether the
token can read the sub-account, not whether anyone is in it; otherwise a new
sub-account would be unconnectable.

### The token is used as an access token, and never refreshed

A Private Integration Token goes in the same `Authorization: Bearer` header,
with the same `Version: 2021-07-28`, to the same endpoint. So
`HttpGoHighLevelClient.fetchContacts` already worked with one, verbatim — the
paging loop, the cursor, the fetch budget, the `truncated` contract, the mapper,
the scheduler and the ingest funnel are all unchanged.

Only the getting of the credential differs, and there `goHighLevelCredential`
branches on the connection's own `authType`. The OAuth path's expiry-and-refresh
dance is not merely unnecessary for a token lane but wrong: a private token is
long-lived and has no refresh token to trade, so `validAccessToken` would reject
the connection for not having one.

## Consequences

- A LeadConnector customer can connect without our Marketplace app being
  installed on their agency, which is the only way past the five-agency cap that
  does not depend on a HighLevel review.
- A mistyped sub-account fails at connect, with HighLevel's own words, instead
  of at 5am.
- One new field on the connect form. That is a real cost and there is no way to
  avoid it.
- This lane only ever reads. Nothing is written back.

## Still open

The failing connection above is not resolved by this, and may not be ours to
resolve. The decisive test is a private token and one contacts call against the
same sub-account: if it fails the same way, the sub-account's state at HighLevel
is the problem and no code change helps; if it works, the Marketplace install is
the problem and this lane unblocks that customer immediately.

Every HighLevel documentation host is blocked by this environment's egress
proxy, so the facts above come from search results quoting those pages rather
than the pages. `docs/leadconnector-private-token-plan.md` marks each one
confirmed or reported. Two reported items stay out of scope and unresolved:
`GET /contacts` may be deprecated in favour of `POST /contacts/search`, and we
do not pace against the published rate limit — today we lean on `Retry-After`
after a 429 to do pacing's job.
