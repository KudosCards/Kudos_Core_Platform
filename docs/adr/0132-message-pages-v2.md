# 0132 — Message Pages v2: reusable QR message pages, woven into the send flow

## Status

Accepted (design; delivered in phases — see "Phased delivery").

## Context

Every Kudos card can carry a QR code that opens a mobile "digital message page"
extending the physical card — a greeting, a video, a written message. The v1
implementation (ADRs 0009-era, `messages` module) is real and working but
deliberately minimal, and one structural choice now blocks the direction we want:

- **`MessagePage` is 1:1 with an `OrderRecipient`** (`orderRecipientId @unique`),
  auto-created for every card at payment time. A page therefore *is* a property
  of a single card line. That makes **reusable pages impossible** (a club can't
  create one "birthday message from the manager" page and put it on 200 cards)
  and means a page **can't be authored independently of an order**.
- Fields are limited to `message`, `emoji`, `videoUrl`, `viewCount`. There is no
  title, no call-to-action, no replies, and the public page plays video via a raw
  `<video>` tag — which **cannot render a YouTube/Vimeo embed**.

The owner shared the current (separate, WordPress) version we're improving on. It
is a **standalone page builder**: create a page with title / video (upload *or*
paste YouTube/Vimeo/Loom/Google Drive) / rich-text message / CTA button / emoji
icon / "allow replies" toggle, and it hands back a QR + URL you then attach to a
card **by hand**. Its dashboard lists pages with view + reply counts, inline
replies, and Preview/Edit/Delete. That confirms the target feature set — and its
core weakness: it's a silo, disconnected from card creation, with only
page-level (not per-card) analytics.

Goal: rebuild it **superior** — same rich authoring, but (1) reusable *and*
bespoke pages, (2) per-card analytics even on a shared page, (3) auto-personalised
greetings from the linked contact, and (4) folded into the normal card
send flow rather than a separate silo — without over-engineering the first pass.

## Decision

### 1. Separate the *content* from the *QR identity*

Split the single table into two ideas:

- **`MessagePage`** — account-owned content, authored once, reused freely:
  `accountId`, `createdByUserId`, `title`, `message` (server-sanitised HTML),
  `emoji`, `videoType` (`none|embed|upload`), `videoUrl`, `videoProvider`
  (`youtube|vimeo|loom|google_drive|null`), `ctaLabel`, `ctaUrl`, `allowReplies`,
  `recipientName` (optional manual greeting fallback), `status` (`active|archived`).
- **`MessagePageLink`** — one QR/slug: `slug @unique`, `messagePageId`,
  `orderRecipientId? @unique` (null ⇒ a standalone/manual QR), `viewCount`,
  `firstViewedAt`, `ctaClickCount` (Phase 2).

Reuse ⇒ one page → many links. Bespoke ⇒ one page → one link. Standalone/manual
(the WordPress "give me a QR to stick on anything") ⇒ a link with no
`orderRecipientId`, personalised from the page's `recipientName`. A card-linked
link auto-personalises from the contact and tracks that card's scans separately.
This is the whole unlock over both v1 and the WordPress version.

**`MessagePageReply`** (Phase 2): `messagePageLinkId`, `senderName`, `body`
(plain text, capped), `createdAt`, `readAt` — tied to the *link* so the sender
knows which recipient replied.

**`MessagePageEvent`** (Phase 3 only): append-only funnel timeline. Not built in
Phase 1/2; the per-link counters leave the seam to grow into it.

### 2. Gated to paid plans

Message Pages is **off for Free, on for Pro / Centre / Enterprise, with no
per-page cap**. Add `messagePagesEnabled Boolean @default(false)` to
`PlanEntitlement` (mirrors `autoSendEnabled` / `customArtworkEnabled`); seed it
`true` for the paid plans. The member authoring endpoints and the send-flow
attach enforce it; the web nav item and the send-flow prompt show a **graceful
upsell** for free-plan users rather than a dead end. The public `/r/:slug` page
is never gated — recipients are anonymous.

### 3. Video: embed-first

A shared `parseVideoEmbed(url)` helper in `@kudos/shared-types` (same pattern as
the dispatch/pricing helpers) recognises **YouTube / Vimeo / Loom / Google
Drive**, returns a normalised privacy-friendly embed URL (`youtube-nocookie`,
etc.), and rejects anything else. Both the API (validate on save) and the web
builder (live preview) use the one helper so they can't drift. **Direct upload**
(the existing `message-videos` bucket + signed-URL route) is deferred to a later
phase.

### 4. Woven into the send flow, gated on a QR design

The composer (`/send`, quick-send) gains an **"Add a personalised message page?"**
step that appears **only when the chosen card design contains a QR element** (with
an offer to add one if it doesn't) — keeping the physical QR and the digital page
in lockstep. Choosing/creating a page associates a `messagePageId` with the order
line(s); at settlement we mint one `MessagePageLink` (unique slug) per order
recipient, all pointing at the chosen page. The design's QR element is composited
with that per-card slug at fulfilment (as today).

### 5. Security & integrity

- **Rich text** stored server-**sanitised** against a tight allowlist
  (`b/i/u/p/br/ul/ol/li`) — closes stored-XSS on a public page and fixes the
  WordPress raw-`<p>` leak.
- **CTA** is https-only, validated, rendered `rel="noopener noreferrer"`.
- **Replies** (Phase 2) are rate-limited, plain-text, length-capped, and only
  when the page allows them — reusing the existing `ThrottlerGuard`/`@Throttle`
  pattern on the public endpoint.
- **Printed QR codes are permanent.** Archiving a page never 404s a card already
  posted — the public page shows a graceful "no longer available"; hard delete is
  blocked while live links exist.
- Public read keeps v1's minimal exposure — no account/order/address data leaves.

### 6. Migration (no broken QRs)

Existing `MessagePage` rows (1:1 with an order recipient, carrying a printed slug)
are split into **one `MessagePage` (content) + one `MessagePageLink`
(slug + orderRecipientId + viewCount)**, **preserving each slug verbatim** so any
card already in the post keeps resolving. Delivered as a Prisma migration + data
backfill, verified against a reseeded database. The public URL stays `/r/:slug`.

## Consequences

- Reusable and bespoke pages are both first-class; a shared page still gives
  per-recipient greetings and per-card analytics.
- Message Pages becomes part of card creation, not a disconnected silo, and a
  clear paid-plan value driver.
- The per-link counters set up the longer-term "sent → scanned → viewed → CTA
  clicked → reply received" engagement story without building it now.
- No card in the wild ever breaks: slugs are preserved on migration and archived
  pages degrade gracefully.

## Phased delivery

- **Phase 1 — the spine (paid-gated):** page/link split + migration (delivered);
  `PlanEntitlement` flag + seed (delivered); page CRUD API + library UI (stats,
  search/filter/sort, preview/edit/
  archive); the builder (title, embed video, rich text, CTA, emoji, replies
  toggle stored but inert until P2) with a live mobile preview; redesigned public
  `/r/:slug`; per-card view tracking; the QR-gated "add a page?" step in the send
  flow; `parseVideoEmbed` + HTML sanitiser.
- **Phase 2 — engagement:** replies (public post → dashboard read → inbox/email
  notification) — **replies delivered** (this PR): `MessagePageReply` tied to the
  scanned link; a throttled, `allowReplies`-gated public `POST /messages/:slug/
  replies` that stores plain text and fires an **inbox** notification
  (`message_reply`) to the account; a dashboard replies panel (list + mark-read)
  with unread counts rolled up onto the library. **Transactional email** on a new
  reply and **CTA-click tracking** (logged redirect incrementing
  `ctaClickCount`) are the remaining Phase 2 items.
- **Phase 3 — insight (later):** the engagement funnel + aggregate analytics
  (`MessagePageEvent`); direct video upload may land here or in Phase 2.

Each phase ships as its own verified PR, merged when the preview is green.

### Delivery log

- **PR 1 — foundations (merged, #231):** the page/link schema split + slug-preserving
  migration, `messagePagesEnabled` entitlement + seed, `parseVideoEmbed` helper.
- **PR 2 — library API (merged, #232):** the account-owned `message-pages` module —
  create (mints a standalone QR link so a page is scannable the moment it's saved),
  list with rolled-up stats (link count + total views), get, update, soft-archive —
  paid-gated on authoring while reads stay open (so a downgrade doesn't hide existing
  pages); server-side HTML sanitiser (`b/i/u/p/br/ul/ol/li`, no attributes) and
  embed-only video validation via the shared helper; v2 shared-types contract.
- **PR 3 — web + send flow (this PR):** the `/message-pages` library UI (stats,
  search / filter / sort, paid-plan upsell) and the builder (title, emoji, embed
  video with live validation, a tiny rich-text editor, CTA, replies toggle) with a
  live mobile preview and the page's own QR + download; the redesigned public
  `/r/[slug]` (title, emoji, embedded video, sanitised rich message, CTA,
  theme-aware, graceful "no longer available" for an archived page) sharing one
  `MessagePageView` with the builder preview so they can't drift; the widened
  public read (`GET /messages/:slug` now returns title / CTA / embed URL / archived
  state); and the **QR-gated "add a message page?" step** in the `/send` composer —
  the chosen page rides on `BulkSendDto.messagePageId` (also accepted on quick-send
  and per line on `CreateBatchOrderDto`), is validated to the account, stored on
  `OrderRecipient.messagePageId`, and at settlement each card's QR link is minted
  onto that shared page (per-card analytics on a reused page) instead of a fresh
  auto-page. The library lists only authored pages, so the per-card auto-pages stay
  on the v1 personalise surface and never clutter it. (The guided single-card
  `/designs/[id]/send` wizard's picker is a fast-follow; its endpoint already
  accepts `messagePageId`.)
