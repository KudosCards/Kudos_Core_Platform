# 0070 — Saved-assets library, shop browsing, and calendar month framing

## Status

Accepted

## Context

Phase 5 of the user-feedback batch, three items:

- **#16 Reusable uploads.** Every time a member wanted to place a logo or photo
  they'd uploaded before, they had to upload it again — the designer kept no
  record of past uploads. Uploads already land in the public `design-assets`
  bucket via a signed URL, but nothing persisted the resulting URL, so there was
  no "library" to pick from.
- **#10 Shop browsing.** The public card catalog (`/cards`) was a single flat
  grid with category filter chips. The owner wanted it to feel like a shop:
  category **carousels**, **search**, occasion/category **filter**, and a
  clearer **"personalise"** call to action.
- A **calendar** follow-up from Phase 3: the list view gave no sense of *when*
  the shown occasions fall relative to now.

## Decision

**Saved-assets library (#16).** A new `DesignAsset` model (`id`, `accountId`,
`url`, `fileName`, nullable `width`/`height`, `createdAt`) records one row per
completed upload. New account-scoped endpoints under `/design-assets`:
`GET` (list, newest first), `POST` (record a finished upload), `DELETE :id`
(remove from the library). The editor records each fresh upload and shows a
**"Your uploads"** strip of thumbnails; clicking one re-inserts the image at its
true aspect ratio (reusing the Phase 4 `fitWithinBox` logic), and a per-thumb ×
removes it.

Key semantic: **`DELETE` only forgets the library entry — it never deletes the
storage object.** A design document already placed may still reference that
`url`, so removing it from "Your uploads" must not break existing cards. The
storage object is left in place deliberately (documented on the model and in the
service). Recording is best-effort on the web side: if the `POST /design-assets`
fails, the image is already on the card, so the upload isn't lost.

**Shop browsing (#10).** `cards-gallery-client` now offers:
- **Carousel mode** when browsing everything with no search — one horizontal,
  snap-scrolling row per `CardDesign.category`, each with a "See all N →" that
  drills into that category. This is the "shop shelf" feel.
- **Grid mode** the moment a category is picked or a search is typed — a single
  flat, scannable grid with a result count and an empty state.
- A **search** box matching card name or category (case-insensitive), alongside
  the existing category chips.
- A clearer **"Personalise this card →"** pill that lifts in on hover, so the
  action is unmistakable rather than relying on the whole tile being a link.

The catalog's existing indexed `category` field powers all of this — no schema
or API change on the catalog side, and the page stays ISR-cached.

**Calendar month framing.** The list view gains a relative section header —
"This month" / "Next month" / "<Month Year>" — plus a "N days with events"
count, so the anchored month reads with context. (Full cross-month grouping
would require widening the list-view fetch, which risks the reload flash fixed
in Phase 3, so it stays month-anchored with prev/next navigation.)

## Consequences

- A logo or photo is uploaded once and reused across designs; the library is
  account-scoped and safe to prune without breaking live cards.
- The catalog reads like a shop: browse by shelf, drill into a category, or
  search — with an obvious personalise CTA at every tile.
- The calendar list view tells you which month you're looking at relative to
  today.
- Tests: `design-assets` e2e covers record/list/delete, null dimensions, URL
  validation, and cross-account scoping (list + delete). Storage-object
  lifecycle for orphaned assets (a future reaper for URLs no design references)
  is left as a follow-up.
