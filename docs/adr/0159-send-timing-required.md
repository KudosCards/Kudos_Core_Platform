# 0159 — Send-timing is a required, unselected choice at checkout

## Status

Accepted — implemented.

## Context

The "When should this go?" choice (**Send now** vs **Schedule delivery**) was
pre-selected on **Send now** on every checkout surface. Because it's a real
dispatch decision — send immediately vs hold and time to a date — a pre-ticked
default is easy to leave untouched by accident: a customer who *meant* to
schedule can pay and have cards go out straight away. User feedback asked for the
field to start unselected and be mandatory, so the choice is always deliberate.

## Decision

Make the send-timing choice **unselected by default and required before payment**
across every checkout surface.

- Shared `SendTimingPicker` (`components/send-timing.tsx`) now accepts
  `value: SendTiming | null`; `null` renders with neither radio checked.
- Callers initialise the timing state to `null` and gate their pay/submit action
  on a choice having been made:
  - **Bulk send** (`/send`) and **single-card send** (`/designs/[id]/send`) — the
    pay button is disabled until a choice is made, with a "Choose when to send to
    continue" hint under the picker; the submit handlers also hard-guard on it.
  - **Guest basket** (`/basket`) — its inline radios became a tri-state
    (`"now" | "scheduled" | null`) with the same disabled-until-chosen button and
    hint.

We chose *disable-the-button-until-chosen + inline hint* over letting the click
through and then erroring, so the requirement is visible up front (and it covers
the large-run "Review & confirm" path uniformly, since that gate is entered via
the same `canPay`). The submit handlers keep an explicit guard as a backstop.

No API change — the wire contract already treats "send now" as an omitted
`deliverBy`; only the client's default changed.

## Consequences

- Cards can't go out on an absent-minded default; the sender always picks.
- One extra click at checkout — deemed worth it for an irreversible dispatch
  decision that spends money.
- The picker's unselected state reuses the existing `has-[:checked]` styling, so
  no highlight shows until a choice is made.
