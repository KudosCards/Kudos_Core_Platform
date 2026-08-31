# 0213 — A grant that cannot sync is not a connection

## Status

Accepted — implemented. Not from the external review; found by investigating a
live customer's GoHighLevel integration.

## Context

GoHighLevel scopes contacts to a **location** (a sub-account). Its consent
screen — the "choose a location" step — also lets the user grant at **agency**
level, and an agency-scoped grant carries no `locationId`. Everything else about
it looks healthy: real access token, real refresh token, a normal expiry.

We stored it anyway:

```ts
create: { …, externalAccountId: tokens.externalAccountId ?? null }
```

From then on the connection was, to every part of the system, connected. The
card showed a green "Connected" pill. The nightly sweep ran it. And every run
threw before it reached GoHighLevel at all:

```
error: GoHighLevel connection is missing its location — please reconnect it
```

A customer followed that advice **four times over five weeks** and imported zero
contacts. The instruction was to repeat the action that had just failed, with no
hint that the choice inside it was the thing that mattered. The banner behind it
said only "We couldn't connect GoHighLevel. Please try again."

This is the failure mode where an error message is technically accurate and
operationally useless: it names the symptom, withholds the decision, and asks
the person to guess.

## Decision

**Refuse the grant at the callback.** A provider that needs an external account
id and doesn't get one has produced something that can never sync, so nothing is
stored. `CRM_PROVIDERS` carries `needsExternalAccount` — true for GoHighLevel,
false for HubSpot and Brevo, which have no such concept and must not be caught
by this.

**Carry a reason back to the page.** `UnusableGrantException` holds a machine
reason (`no_location`); the callback appends it as `?error=<provider>&reason=…`,
and the banner turns it into the sentence that was missing:

> GoHighLevel gave us access to an agency rather than one of its sub-accounts,
> and an agency has no contacts to import. Connect again and choose the
> sub-account you want contacts from.

**Say the same thing to connections already in that state.** Rows stored before
this change still exist — one customer is holding one right now — so the
sync-time error stops saying "please reconnect it" and says which choice to make.

**A refused reconnect leaves a working connection alone.** Picking the agency by
mistake when you already have a good connection must not destroy it. The guard
runs before the upsert, so the existing row and its tokens are untouched.

## Consequences

- A GoHighLevel connection either works or was never created. There is no third
  state that presents as healthy and fails nightly.
- The customer is told which of the two choices to make, at the moment they can
  act on it, rather than after the next night's failure.
- 9 mutations, all caught: removing the guard, applying it to every provider
  (which would break HubSpot), flipping `needsExternalAccount`, dropping the
  reason from the redirect, moving the guard to after the upsert, reverting the
  sync-time message, and both directions of the banner's reason check.
- HubSpot and Brevo are explicitly unaffected — there is a mutation that fails
  if this ever starts applying to them.

## What this does not do

It does not fix the customer's sync. Their most recent grant is agency-scoped,
so this change would have refused it and told them why — which is the point —
but the earlier attempt that _did_ carry a location still returned 401 from
GoHighLevel's contacts endpoint. Whether that was the Marketplace app being
`Disapproved` at the time, or something else, is still unknown. ADR 0212 is what
will answer it: the next failure will quote GoHighLevel's own words.

The agency option itself lives on GoHighLevel's consent screen, which we do not
render and cannot change from here. The app's Target User is already
`Sub-Account`; the remaining setting that can produce an agency-scoped grant is
"Can agency bulk install the app?", which is a Marketplace configuration
decision rather than a code one.
