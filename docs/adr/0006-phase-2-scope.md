# ADR 0006 — Phase 2 scope: occasion approval vs. checkout, scheduler design, designer stack

Status: accepted
Date: 2026-07-16

## Context

Phase 2 covers three areas from the roadmap: the occasion engine, the card designer, and the
approval workflow. The schema already has `Occasion`, `CardDesign`, `SavedDesign`, `BatchOrder`,
and `OrderRecipient` scaffolded (Phase 0), but several things were left genuinely undecided:

1. `OccasionStatus` and `OrderRecipientStatus` are near-parallel state machines
   (`pending_approval → approved → queued → printed → posted → delivered`). It's not specified
   whether "approving an occasion" *is* the checkout step (creating a priced, paid `BatchOrder`),
   or a separate, earlier gate.
2. Nothing creates `Occasion` rows yet — the scheduling mechanism (when, how often, how far
   ahead) was never designed.
3. ADR 0004 deferred the canvas library choice ("Fabric.js or Konva") and didn't address image
   uploads, which need Supabase Storage — not wired into the platform yet.

## Decision

**Occasion approval is a lighter gate than checkout, not the same step.** Approving an occasion
means "yes, send a card for this" and records which `SavedDesign` was chosen
(`Occasion.savedDesignId`, added nullable in this phase). It does **not** create a `BatchOrder`,
does not price anything, and does not touch Stripe. Turning approved occasions into a paid,
fulfillable `BatchOrder`/`OrderRecipient` (which needs pricing, postage class, dispatch timing,
and payment) is real, separate scope — Phase 3 (Checkout & Fulfillment), matching ADR 0002/0003's
existing batch-order and billing-separation design. `Occasion.status` therefore only reaches
`approved` or `skipped` in Phase 2; `queued` onward is Phase 3's responsibility to set once it
creates the corresponding `OrderRecipient`.

**Scheduler covers birthdays only, on a lookahead window, no "scheduled" holding state yet.** Of
the six `OccasionType`s, only `birthday` has a natural recurring source (`Recipient.dateOfBirth`).
A daily cron (`@nestjs/schedule`) creates `Occasion` rows directly in `pending_approval` for every
active recipient whose next birthday falls within a 21-day lookahead window, computing
`dispatchDate` as `occasionDate` minus a default 5-day postage lead time. Idempotency is enforced
by the existing `occasion_idempotency_key` unique constraint. The other five occasion types are
created manually via the API (e.g. a leaver or an achievement) — no auto-scheduling for those in
this phase. The `scheduled` status is intentionally unused for now (occasions outside the
lookahead window simply don't exist yet, rather than existing in a far-future browsable state);
a longer-range calendar view is a reasonable future enhancement, not required for Phase 2.

**Card designer: Konva (`react-konva`) + Supabase Storage wired up now.** Konva's React bindings
are declarative (shapes as JSX driven by state), which fits this codebase's existing React
patterns better than Fabric.js's imperative canvas-object API. Supabase Storage is wired up in
this phase (a bucket + signed-upload-URL endpoint) rather than deferred — a card designer that
can't handle a photo isn't a usable v1 for a physical-card product, and deferring it would just
turn into an immediate follow-up phase.

## Alternatives considered

- **Make "approve" the same action as checkout** (occasion approval directly creates a priced
  `OrderRecipient`) — rejected: pricing needs postage class + dispatch option + plan discount +
  Stripe, none of which exist yet. Conflating "do we want to send this" with "pay for this now"
  also removes the ability to batch multiple approved occasions into one order later, which is
  the whole point of ADR 0002's batch-order model.
- **Auto-schedule all occasion types**, not just birthdays — rejected: only birthdays have a
  recurring source field on `Recipient` today. Achievement/leaver/seasonal/bespoke occasions are
  inherently event-driven (something happened, an admin decides to send a card), not calendar-driven.
- **Defer image uploads to a later phase** — considered, see Context; rejected as making Phase 2's
  designer output feel unfinished rather than shipping a genuinely usable tool.
- **Fabric.js** for the canvas — considered; more built-in object-manipulation UI (resize handles,
  grouping) out of the box, but its imperative API needs more glue code to stay in sync with React
  state than Konva's declarative model.

## Consequences

- `Occasion` gains a nullable `savedDesignId` column, giving Phase 3's checkout flow a natural
  source to copy from when it creates `OrderRecipient.savedDesignId` (which is required, not
  nullable) — the design choice travels with the occasion instead of being re-selected at checkout.
- No pricing, postage, or Stripe logic ships in Phase 2 — that's explicitly Phase 3, keeping this
  phase's surface area (and review/test burden) bounded.
- The lookahead window (21 days) and postage lead time (5 days) are hardcoded constants, not env
  vars or account-configurable settings — reasonable defaults to tune once real print/post lead
  times are known, not a permanent design choice.
- Supabase Storage becomes a new operational dependency (a bucket to provision, `SUPABASE_URL`/
  `SUPABASE_SERVICE_ROLE_KEY` already exist in env for JWKS auth and are reused here for signed
  upload URLs — no new secrets needed).
