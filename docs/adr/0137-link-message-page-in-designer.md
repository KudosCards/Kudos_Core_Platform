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

For each card at settlement:

1. **Send-time choice** — an explicit `messagePageId` on the order line
   (the send flow / bulk composer), which the customer can override per send.
2. **Design-linked page** — `DesignDocument.messagePageId`, validated active +
   same account.
3. **Raw video** — auto-create a minimal page seeded from `DesignDocument.videoUrl`.
4. **None** — a plain page with no video.

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
- **Phase 3 — Settlement.** `createForOrderRecipients` resolves the effective
  page by the precedence above — the one change that covers single, bulk,
  quick-send, and auto-send, because they all funnel through `settleFulfillment`.
  The design-linked id is validated (`status: active`, `accountId` match) before
  use; anything invalid falls through to the video/none path.

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
- **Resolve the design-linked page at order-creation in each path.** Rejected:
  four code paths to keep in sync (and auto-send has no UI). Resolving once at
  the shared settlement choke point is DRY and impossible to forget.
- **Drop `videoUrl` entirely in favour of pages.** Rejected: the raw-link
  shortcut is the fastest path for a customer who just wants a video, and
  removing it would break existing designs.
