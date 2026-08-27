# 0113 — Click & Drop connection diagnostics & configurable auth scheme

## Status

Accepted

## Context

The Royal Mail Click & Drop order-import integration (ADR 0095) wasn't working
in production, and diagnosing it was slow: the only signal was a per-card
`clickAndDropError` string populated by the background sweep every 5 minutes, so
validating a key change meant paying, waiting for a settlement job, then waiting
for a sweep. Royal Mail's own docs also block automated access (Cloudflare 403),
and the published sources disagree on one detail: the [help-centre cURL example](https://help.parcel.royalmail.com/hc/en-gb/articles/360011462338-Integrating-with-the-Click-Drop-API)
sends the API key **raw** in `Authorization`, while some SDK docs prefix
`Bearer`. We needed a way to test connectivity on demand and to flip the auth
scheme without a redeploy.

## Decision

### 1. A live, read-only connection probe

`ClickAndDropClient` gains `probe()`: a **GET** to `/api/v1/orders` that validates
the base URL, network path and API key **without creating an order**. It never
throws — it returns `{ ok, status, body, endpoint, authScheme, error? }` with the
body truncated. The no-op client (no key) returns `status: 0` and a
"not configured" body.

- Service: `ClickAndDropService.testConnection()` wraps it and adds `enabled`.
- API: `POST /fulfillment/click-and-drop/test`, gated by `PlatformAdminGuard`
  like the rest of the fulfilment controller.
- Web: a **"🔌 Test Click & Drop"** button on the ops fulfilment queue shows the
  raw verdict inline (`HTTP 401 · raw auth · <endpoint>` + body), so a non-dev
  operator can confirm a key in seconds.

The status is the diagnosis: **401/403** → wrong or blank key (a _subscription_
key from developer.royalmail.net is not a Click & Drop _API_ key); a `duplicate`
message in a `failedOrders` body → a card already exists at Royal Mail but its id
wasn't recorded; **400** → a request-body field mismatch; **2xx** → the credential
works.

### 2. Configurable Authorization scheme

`CLICK_AND_DROP_AUTH_SCHEME` (`raw` | `bearer`, default `raw`) selects the header
form. `raw` matches Royal Mail's official cURL example; `bearer` is available for
an account that needs `Authorization: Bearer <key>` — flippable via env, no code
change. Applied to both `createOrder` and `probe`.

### 3. Fuller failure logging

The create-order error now includes the method + endpoint alongside the status
and body (`... POST https://…/api/v1/orders (401): …`), so a logged failure is
self-describing.

## Consequences

- The integration is now self-diagnosing from the ops console; a key or base-URL
  problem is a one-click check instead of a 5-minute sweep wait.
- No schema change; the probe is read-only and safe to run any time.
- Covered by a client unit spec (raw vs bearer header, probe status/body, network
  error capture) and an ops-gated endpoint e2e.

## Alternatives considered

- **Probe by creating a throwaway order.** Rejected: it would leave a real order
  in the operator's Click & Drop dashboard. A read-only GET validates auth without
  side effects.
- **Hard-code `Bearer`.** Rejected: Royal Mail's own example is raw, and the
  sources conflict — an env toggle avoids guessing wrong and needing a redeploy.
