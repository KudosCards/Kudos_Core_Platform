# 0234 — The name a Location user must never see

## Status

Accepted — implemented. Supersedes the scope of ADR 0156, which fixed one half
of this. Prompted by the GoHighLevel Marketplace rejecting our app listing.

## Context

GoHighLevel is sold **white-label**. An agency resells it to its clients under
its own branding, so a Location user may know the product only as "their
agency's CRM" and have never heard of HighLevel. A marketplace app installed by
a Location must therefore never reveal the platform underneath. Their reviewer's
words:

> The integration on your platform is called HighLevel CRM, since the APP is a
> whitelabel listed APP targeted towards Locations, mention or showcasing of any
> HighLevel references will breach whitelabel, please fix it.

**We had already hit this policy once.** ADR 0156 records their marketplace
refusing to _save our redirect URL_ because the string contained "gohighlevel",
and solving it by registering `…/oauth/leadconnector/callback` and aliasing the
slug back on the way in. That ADR considered renaming more widely and rejected
it as "far larger blast radius… to avoid one alias line".

Reasonable at the time, and it left this, in the same handler:

```ts
const provider = OAUTH_CALLBACK_SLUG_ALIASES[providerParam] ?? providerParam; // "gohighlevel"
const back = (status) => `${webAppUrl}/integrations?${status}=${encodeURIComponent(provider)}`;
```

The URL was sanitised on the way **in** and the brand put straight back on the
way **out**. Every successful install finished at
`/integrations?connected=gohighlevel`, in the address bar, with a banner reading
**"GoHighLevel connected — click Sync now to import your contacts."** That is
the one screen a reviewer is guaranteed to reach.

The recon found nine user-visible surfaces, and two things worth naming:

**The display name lived in four independent copies** — the integrations page,
the contacts list, the smart-list rule builder and the ops subscriber page each
carried its own `{ gohighlevel: "GoHighLevel" }`. Fixing three and missing one
is how an app gets rejected twice.

**One breach had no brand in it at all:**

```ts
throw new UnauthorizedException(`${provider} connection has no refresh token — reconnect it`);
```

That renders as _"gohighlevel connection has no refresh token"_. A grep for the
brand would never have found it, because the brand is not written there.

## Decision

Remove every reference a Location user can reach, and leave the internal key
alone. The line is drawn at **how the name is written**:

| Form                                     | What it is                                      | Verdict   |
| ---------------------------------------- | ----------------------------------------------- | --------- |
| `GoHighLevel`, `HighLevel`, `High Level` | prose someone reads                             | forbidden |
| `gohighlevel`                            | the stored provider key, a prop, a path segment | allowed   |
| `GOHIGHLEVEL_CLIENT_ID`                  | an env var name, server-side only               | allowed   |

Identifiers keep one case throughout; prose mixes case or takes a space. That is
a rule a machine can check, which is the point.

**The display name is `LeadConnector`,** and that is not a euphemism we invented:
it is HighLevel's own white-label name — their API host is
`services.leadconnectorhq.com`, it is the placeholder in their own marketplace
fields, and we already know their filter accepts it, because our redirect URL
has been registered under that word since ADR 0156.

**One shared map** (`CRM_PROVIDER_LABELS` in shared-types) replaces the four
copies, keyed by both the internal slug and the public OAuth slug.

**The redirect carries the public slug.** `PUBLIC_OAUTH_SLUGS` is the inverse of
the existing alias map, applied to the _resolved_ provider rather than echoing
the inbound path param — that param is unvalidated URL input, and reflecting it
would put arbitrary text into the banner the page renders from this value.

## Consequences

- No screen, message or URL a Location user sees names HighLevel.
- The stored `provider`/`source` values, the API paths and the env vars are
  unchanged, so no migration and no Railway re-entry.
- Four mutations caught: the brand back on the connector card, back in an API
  error, the label map losing its entry, and the redirect carrying the internal
  key again.

**Two guards**, because the rule is only worth having if it cannot be quietly
re-broken:

- `apps/web/.../no-whitelabel-breach.test.ts` — no display spelling anywhere in
  the web app, comments stripped.
- `apps/api/.../no-whitelabel-breach.spec.ts` — no display spelling inside a
  **string literal**. Narrower on purpose: the API legitimately keeps
  `GoHighLevelContact` and `mapGoHighLevelContact`, which are identifiers. A
  string literal is not — it is either shown to someone or logged where it may
  be.

The web guard is **deliberately strict**: it would fail on the ordinary English
phrase "a high level of care". For a rule whose false negative costs a
marketplace rejection and whose false positive costs a reworded sentence, that
is the right way round.

**And one thing neither guard can see.** `crmProviderLabel` falls back to
capitalising an unknown slug, so a missing entry would render "Gohighlevel" — a
breach in a string that is never written down. A test asserts every supported
provider has an explicit label, which is the only place that could be caught.

## What is deliberately not done

`gohighlevel` remains the stored `CrmConnection.provider` and `Recipient.source`
value, the API path segment (`/connections/gohighlevel/sync`) and the `<option
value>` in the contacts filter. A reviewer with devtools open could find it.

That was a scoping call, taken knowingly: renaming it needs a data migration and
touches the OAuth start route, and the display surfaces are what the rejection
named. The cost of changing it later rises with every stored row, so if a
resubmission is refused again, this is the next thing to do rather than a thing
to discover.

## The shape, again

ADR 0156 fixed this where the finding pointed — the redirect URL — and the
identical defect survived one line away in the same function. That is the sixth
time in recent work; it is the same pattern as ADRs 0221, 0224, 0226, 0227, 0228
and 0233, and it went unnoticed here for the same reason as always: the fix was
marked done because the thing that reported it stopped complaining.
