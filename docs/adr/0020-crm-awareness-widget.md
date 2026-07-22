# ADR 0020 — CRM awareness widget on the contact-import surfaces

Status: accepted
Date: 2026-07-22

## Context

The CRM integrations (Brevo, HubSpot, Zapier, inbound API — ADR 0015) exist, but they live on a
separate `/integrations` page a new subscriber may never notice. Meanwhile the moment a user is most
likely to want an easier path than CSV is exactly when they're staring at the manual "import a CSV"
form. That awareness gap is what this closes.

## Decision

A small, presentational **`ConnectCrmCallout`** component placed next to the manual contact-import
paths, pointing at `/integrations` (where the real connect flows already live):

- **Recipients page (`/recipients`)** — the full callout: a bordered card directly under the
  Add-recipient / Import-CSV cards, with the named connectors (Brevo, HubSpot, Zapier, your own API)
  and a single "Connect an integration →" CTA.
- **Guided setup upload step (`/get-started`)** — a `compact` one-line variant under the import form,
  so the very first upload moment also surfaces the option without crowding the step.

It is deliberately **awareness only** — no connect logic, no new endpoints. The component is a plain
(non-client) component reused in both places, so the copy and the connector list stay in one spot.

## Alternatives considered

- **A third card in the Add/Import row.** Rejected — it crowds that row and competes with the two
  primary actions; a full-width callout underneath reads as "here's the faster alternative" without
  fighting them.
- **Provider logos.** Deferred — there are no brand assets in the repo yet, and shipping text chips
  now avoids blocking on sourcing/licensing logos. Easy to add later.

## Consequences

- The connector list is duplicated as display text here and on `/integrations`; both are small and
  co-located conceptually, and the ADR notes to keep them in step when a connector is added/removed
  (e.g. GoHighLevel when it goes live).
- Purely additive and presentational — no API, schema, or test surface change.
