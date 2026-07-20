# ADR 0009 — Phase 4 scope: the digital message page module

Status: accepted
Date: 2026-07-16

## Context

Phase 4 was already named and scoped in one place before this session touched it:
`apps/web/src/app/r/[slug]/page.tsx` is a placeholder stub, committed early, whose own comment
says "the QR message-page module (Phase 4)". The `MessagePage` Prisma model has existed since
Phase 0 (`id`, `slug` unique, `orderRecipientId` unique 1:1, nullable `message`/`emoji`/`videoUrl`,
`viewCount`, `createdAt`) but has never had any API built against it.

A pre-implementation review (see the Phase 0-3 review PR) confirmed:
- `packages/shared-types`'s `messagePageSchema` and `fulfillmentJobSchema` are both already
  accurate against the real Prisma models — safe to build on directly, unlike several other
  schemas in that package that needed fixing first.
- **`FulfillmentJob` never advances past `pending` anywhere in the codebase.** The webhook
  creates one per paid `OrderRecipient` (`webhooks.service.ts`) and nothing else touches it — no
  ops/staff API, no admin UI, no cron. This is a real, pre-existing gap independent of Phase 4.
- No slug-generation utility exists anywhere in the repo.
- No genuinely public (non-webhook) endpoint exists yet, and no rate-limiting infrastructure
  (`@nestjs/throttler` or equivalent) has been installed.
- No message/emoji/video content is captured anywhere in the current checkout flow.

## Decisions

**MessagePage creation point**: a `MessagePage` row (slug generated, content fields null) is
created for every `OrderRecipient` at the same moment its `FulfillmentJob` is created — i.e.
inside `WebhooksService#handleCheckoutSessionCompleted`, alongside the existing
`fulfillmentJob.createMany(...)`. This guarantees every paid card has a working QR-code target
from the moment it enters production, independent of whether the message content has been
authored yet (an unauthored page just renders "no message yet").

**Personalisation is a separate, optional, always-editable step**: the tuition centre authors
message/emoji/video *after* checkout, not during it — there's no existing capture point in
checkout and forcing one in would couple two independently-changeable flows. A new page lists the
`OrderRecipient`s from a paid `BatchOrder` (or all of an account's message pages) with editable
content. Nothing currently marks a `FulfillmentJob` "printed", so there's no real deadline to
enforce yet; personalisation stays editable indefinitely for this phase.

**Fulfillment-staff tooling (progressing a job past `pending`) is explicitly out of scope for this
phase.** It's a distinct feature area — an entirely different actor (Kudos Cards' internal
print/post team, not the B2B customer) — that was never part of Phase 4's own definition. Jobs
stay manually progressed (direct DB update) until a dedicated ops phase. Flagged here so it isn't
mistaken for an oversight.

**Slug**: generated with `nanoid` (a small addition — nothing existing covers this; pinned to the
3.x line because 6.x is ESM-only and this API compiles to CommonJS, the same trap ADR 0007
documents), 10 characters from a 56-char unambiguous alphabet, matching `messagePageSchema`'s
`min(6)` hint that this is a short, QR/typeable code rather than a UUID. Pages are created in a
batch `createMany({ skipDuplicates: true })` per paid order — `skipDuplicates` is really there for
webhook-redelivery idempotency (the `orderRecipientId` unique constraint), and it also absorbs the
astronomically unlikely slug collision (~10⁻¹⁷ per card at this entropy) rather than needing a
per-row retry loop.

**Public endpoint + rate limiting**: `GET /messages/:slug` (view) and the `viewCount` increment
are the first genuinely public, unauthenticated, arbitrary-input endpoints in this API. Adds
`@nestjs/throttler`, scoped only to this controller — not applied globally, to avoid changing
behaviour on any existing authenticated route. `viewCount` increments via Prisma's atomic
`{ increment: 1 }` (confirmed the right primitive — no read-then-write race). No session/IP
dedup on views for this phase (simplest correct behaviour for an unauthenticated page), and
`viewCount` is not exposed via any account-facing API yet — easy to add later, avoids deciding
the product question of whether centres should see view counts.

**Video storage**: reuses the existing `StorageService`/signed-upload pattern from Phase 2
(`design-assets` bucket), extended to a second bucket (`message-videos`) rather than building new
upload plumbing. Given the Phase 0-3 review already flagged that upload size/type isn't enforced
at the application layer (only possible via Supabase bucket config), a `fileSizeLimit` on this
bucket is more important here than it was for card images — noted for the user to set in the
Supabase dashboard, not something this codebase can enforce itself.

## Alternatives considered

- **Creating MessagePage lazily on first personalisation** — rejected: would mean some paid
  cards have a working QR target and some don't, depending on whether the centre has personalised
  yet, which is a worse, less predictable state than "always exists, sometimes empty."
- **Requiring personalisation during checkout** — rejected: couples two flows that don't need to
  be coupled, and blocks payment on an optional creative step.
- **Building fulfillment-staff tooling alongside this** — rejected for this phase: different actor,
  different UI surface, unbounded scope creep relative to what Phase 4 was actually named for.

## Consequences

- Every paid card has a resolvable QR-code URL immediately, decoupled from whether/when it gets
  personalised or (eventually) printed.
- `@nestjs/throttler` is a new, narrowly-scoped dependency — first time this API has needed to
  defend an endpoint against anonymous abuse rather than relying on auth as the gate.
- Fulfillment progression remaining unbuilt is now a documented, deliberate gap rather than a
  silent one — worth a dedicated ops phase later.

## Addendum (2026-07-20): the QR code + video linking

Phase 4 shipped the message-page *target* (`/r/<slug>`) and noted a card would carry a QR code to
it — but never generated the QR or gave the subscriber a way to attach a video from the designer.
This addendum closes that loop.

- **A `qr` design element** (shared-types `designElementSchema`) — placement + size only. Like the
  `{name}` text token, the element carries no URL: the real per-recipient `/r/<slug>` is substituted
  at render time, because the slug is per sent card, not per design. The card designer renders a
  placeholder QR so the subscriber can position it inside the card.
- **A document-level default video** (`designDocumentSchema.videoUrl`) set from the designer's
  "Video link" field (URL-based first — YouTube/Vimeo/hosted; per-recipient upload to the
  `message-videos` bucket already exists on the Messages page).
- **Seeding:** when the payment webhook creates a `MessagePage` per `OrderRecipient`
  (`createForOrderRecipients`), it now copies the design's default `videoUrl` onto each page — so the
  QR works from the first scan. The subscriber can still override per recipient on `/messages`.
- **The real QR is shown on `/messages`** per card (encoding the absolute `/r/<slug>`), with a
  download for printing. Deliberately client-side (`qrcode`), so no new API surface or stored image.

Scope kept deliberately narrow: **there is no server-side card rasteriser** in this codebase (ops
composites the card from the design document + recipient data), so this phase delivers the QR as a
downloadable per-recipient asset rather than compositing it into a print-ready card image — that
belongs with whatever print pipeline ops adopts, and is the natural follow-up.

- Video scope: **per-recipient** (reuses the Phase 4 message page), not one video per design —
  chosen for personalisation, since the per-recipient page already existed.
