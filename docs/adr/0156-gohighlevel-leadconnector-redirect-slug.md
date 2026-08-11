# 0156 — Register the GoHighLevel OAuth callback under a white-label "leadconnector" slug

## Status

Accepted — implemented.

## Context

Our OAuth callback route is generic: `GET /integrations/oauth/:provider/callback`,
so GoHighLevel's would naturally be
`https://<api-host>/integrations/oauth/gohighlevel/callback` — matching the
internal provider key we use everywhere (`gohighlevel`: the DB `CrmConnection.provider`
value, the `GOHIGHLEVEL_*` env vars, the web connector's `provider` prop).

But the GoHighLevel Marketplace **rejects that redirect URL**. Its white-label
policy refuses to save any redirect URL whose string contains "highlevel" or
"gohighlevel" ("The redirect uri contains a Highlevel reference. Please remove
any Highlevel references to save"). GHL's own docs and the field's placeholder
use the neutral name **"leadconnector"** (their token/API host is
`services.leadconnectorhq.com`), which is the sanctioned convention.

So the redirect URL registered in the Marketplace app cannot carry our provider
slug — but the token exchange still requires `redirect_uri` to match the
registered URL exactly, and our callback route is keyed on `:provider`.

## Decision

Register the GoHighLevel callback under the white-label-safe slug and map it back
to our internal provider on the way in:

- Registered redirect URL / `GOHIGHLEVEL_REDIRECT_URI`:
  `https://<api-host>/integrations/oauth/leadconnector/callback`
- The controller holds a tiny alias map,
  `OAUTH_CALLBACK_SLUG_ALIASES = { leadconnector: "gohighlevel" }`, and resolves
  the inbound `:provider` param through it at the top of the callback handler.
  Everything downstream (`completeOAuth`, the signed-state provider check, the
  redirect back to `/integrations?connected=gohighlevel`) uses the resolved
  `gohighlevel` key unchanged.

Nothing else moves: the DB `provider` value, the `GOHIGHLEVEL_*` env var names,
and the web connector all stay `gohighlevel`. Only the **public URL slug**
differs, and only for the callback (the `/start` route is called by our own web
app, never registered with GHL, so it keeps the `gohighlevel` slug).

## Consequences

- The redirect URL saves in the GHL Marketplace, unblocking the OAuth install
  (draft or published).
- Existing HubSpot OAuth is untouched — its slug already equals its provider key,
  and the alias map only rewrites `leadconnector`.
- The e2e suite exercises the real production path: the callback is driven
  through `/integrations/oauth/leadconnector/callback` and still asserts the
  connection is stored and the browser is redirected with `connected=gohighlevel`.
- Operational note: `GOHIGHLEVEL_REDIRECT_URI` in Railway must be set to the
  `…/leadconnector/callback` URL, identical to the one registered in the
  Marketplace app.

## Alternatives considered

- **Rename the provider to `leadconnector` everywhere** (DB value, env vars, web
  prop, descriptor). Rejected: far larger blast radius — it would rename the
  `GOHIGHLEVEL_*` env vars (forcing a Railway re-entry) and change the stored
  `provider` value, all to avoid one alias line. No GHL connections exist yet, so
  it's not about data migration — it's simply more churn for no benefit.
- **A dedicated, hard-coded `/oauth/leadconnector/callback` route** separate from
  the generic `:provider` one. Rejected: duplicates the callback logic; the alias
  map reuses the existing generic handler with a one-line resolve.
- **Use an abbreviation like `ghl`.** Would likely pass the filter, but
  `leadconnector` is GHL's own documented convention (and their placeholder), so
  it's the least surprising and least likely to trip a future policy tweak.
