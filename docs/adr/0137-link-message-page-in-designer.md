# 0137 — Link a Message Page to the card's QR in the designer

## Status

Accepted — all phases implemented. Phases 1–3 are the spine (designer picker,
send-flow default, settlement resolution); Phases 4–5 add the naming
unification ("Add scan-to-watch QR", consistent "message page" language) and
the designer's richer destination preview (emoji + title + video/button/replies
badges).

## Context

ADR 0132 introduced Message Pages (rich digital pages — title, emoji, video,
message, CTA button, replies, analytics) reachable by scanning a card's QR
code. ADR 0136 added their analytics. But the two halves of the feature never
met where customers expect them to:

- **The card designer** (`/designs/[id]/edit`) only offers a **raw video URL**
  (`DesignDocument.videoUrl`, ADR 0132). At settlement, a card with no chosen
  page gets a bare auto-created *"Your message"* page seeded with that video.
  The rich Message Pages a customer built are **invisible in the designer**.
- **Message Pages** are built in a separate `/message-pages` area and can only
  be attached at **send time**, via a dropdown that appears only when the design
  already carries a QR element.

The result is a real mental-model gap: a customer crafts a beautiful message
page, then goes to design their card and finds only a "Video link" field — the
card and the personal message feel like two disconnected worlds. There are also
two competing "video" sources (`design.videoUrl` vs. an attached page) with
silent, undocumented precedence.

The backend plumbing is already sound: `MessagePageLink` binds a card to any
account page, and `settleFulfillment` (`batch-orders.service.ts`) — the single
post-payment step shared by **every** order path (Stripe webhook, wallet debit,
and auto-send) — calls `MessagesService.createForOrderRecipients`, which already
branches on a per-line `messagePageId`. So this is a surfacing + wiring change,
not new infrastructure.

## Decision

Make the **Message Page the first-class QR destination**, chosen in the
designer, carried through send as the default, and honoured at settlement for
every order path. The raw video URL stays as a convenience shortcut that
auto-builds a minimal page (exactly as it does today). Fully backward
compatible: existing designs with only a `videoUrl` behave unchanged.

### Storage — on the design document JSON

A new optional `messagePageId` on `DesignDocument`, beside the existing
`videoUrl`. Chosen over a `SavedDesign` FK column because:

- It travels with the design (matches how `videoUrl` already lives there) and
  needs **no migration**.
- Message Pages are account-scoped; shared catalog templates cannot carry an
  account's page id, so a document field (only ever set on an account's own
  saved design) fits the ownership model better than a schema FK.
- The referential-integrity cost of JSON is handled explicitly: settlement
  **re-validates** the referenced page is still active and owned by the paying
  account, and degrades gracefully (to `videoUrl`, then none) if not — the same
  robustness the archived-page path already has.

### Precedence (single, explicit rule)

Each card's page is decided **at order creation** and carried on the order line;
settlement honours that choice verbatim (it never re-derives from the design):

1. **Send-time choice** — the send/bulk composer pre-fills the design's linked
   page as the default and lets the customer override it per send (including
   clearing it to "no page"). Whatever the composer submits is the choice.
2. **Auto-send fallback** — auto-send has no composer, so it resolves the
   design's linked page itself at order creation, validated active + same
   account, and sets it on the order line.
3. **Raw video** — for a line with no page, settlement auto-creates a minimal
   page seeded from `DesignDocument.videoUrl`.
4. **None** — a plain page with no video.

> **Amendment (post-implementation).** The original design resolved the
> design-linked page **at settlement** (step 2 below), which could not tell an
> explicit "no page" from "not chosen": a nullable `messagePageId` collapses
> both to null, so a sender who cleared the page still had the design's page
> re-attached — their opt-out was ignored. Resolution therefore moved *upstream*
> to the point that knows the difference. The interactive composers already
> carry an explicit choice; auto-send (the only path with no composer) now
> resolves the design's linked page itself. Settlement no longer consults the
> design document for the page, so a cleared choice is honoured everywhere.

### Phases

- **Phase 1 — Designer.** When a QR element is present, the panel asks *"What
  plays when they scan this?"*: pick one of the account's active Message Pages
  (with an inline preview + a "New page" link) **or** "just a video link" (the
  existing field, reframed). Sets `messagePageId` or `videoUrl` on the document.
  The editor's server page now also loads the account's message pages and its
  message-pages entitlement.
- **Phase 2 — Send flow.** The single-send and bulk composers pre-select the
  design's linked page as the default (still overridable), so the customer
  doesn't re-pick what they already chose in the designer.
- **Phase 3 — Settlement.** `createForOrderRecipients` mints each card's QR link
  onto the order line's chosen page, or a fresh auto-page (seeded from the
  design's video, else empty) when the line chose none. It does **not** re-derive
  the design's linked page — see the amendment above: the page is chosen upstream
  (composer or auto-send) so an explicit "no page" is preserved. The design-linked
  id is validated (`status: active`, `accountId` match) at that upstream point.

### Phase 4–5 — Naming + preview

The designer's "Add video QR" becomes "Add scan-to-watch QR"; the QR help text
and the public card-preview bullet drop "video message" for "message page"
language, since the QR now resolves to a full page, not just a video. The
designer's destination picker shows a small preview tile (emoji, title, and
Video/Button/Replies badges) so the chosen page is tangible before send.

## Consequences / blast radius

- Confined to the designer, the send composers, the shared-types design schema,
  and the settlement page-minting step. **No** change to payment, wallet,
  fulfillment state, or the public `/r/<slug>` page.
- No migration; additive optional field. Old documents (no `messagePageId`)
  take the unchanged `videoUrl`/none path.
- The security boundary is preserved: a design document cannot bind a card to
  another account's page — settlement validates ownership before linking.
- One extra indexed lookup at settlement (active pages for the referenced ids),
  batched across the order; negligible next to the writes already there.

## Alternatives considered

- **FK column on `SavedDesign`.** Stronger integrity, but a migration, and it
  doesn't fit shared catalog templates. The JSON field with settlement-time
  validation gives equivalent safety for this ownership model.
- **Resolve the design-linked page only at the shared settlement choke point.**
  The original choice (DRY, impossible to forget), later reversed by the
  amendment above: settlement can't distinguish an explicit "no page" from "not
  chosen", so it re-attached a page a sender had deliberately cleared. Resolution
  now lives where the intent is known — the composers (which already carry an
  explicit choice) and auto-send (the one path with no composer). Settlement
  honours the line verbatim.
- **Drop `videoUrl` entirely in favour of pages.** Rejected: the raw-link
  shortcut is the fastest path for a customer who just wants a video, and
  removing it would break existing designs.
