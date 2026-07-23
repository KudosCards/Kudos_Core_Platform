# ADR 0026 — Member-uploaded custom artwork + "My designs" prominence

Status: **accepted**
Date: 2026-07-23

## Context

User feedback on the card design shop asked for two related things:

1. **Make "My designs" prominent.** The `/designs` page led with the template catalog and buried a
   member's own saved designs underneath it. But once someone has built and saved designs, those
   are what they return for — the catalog is a starting point, not the destination.
2. **Let subscribers upload their own artwork.** Tuition centres frequently have their own branded
   card artwork (a designer-made front, a seasonal illustration) and want to send *that* as a card,
   not only personalise one of our catalog templates. This is a paid-tier value-add, not a
   free-plan feature.

Until now every `SavedDesign` was a personalised copy of a catalog `CardDesign` — the FK
`SavedDesign.cardDesignId` was **required**. Uploading standalone artwork has no template behind
it, so that assumption had to change.

## Decision

### Data model

- **`SavedDesign.cardDesignId` becomes nullable.** `null` means "a member's own uploaded artwork"
  — a saved design with a real document but no catalog template lineage. The relation is now
  optional (`CardDesign?`). Nothing joins `savedDesign.cardDesign` for display, so the blast radius
  is small; the FK stays for template-derived designs so catalog provenance is still recorded.
- **`PlanEntitlement.customArtworkEnabled Boolean @default(false)`** — a new feature gate, enforced
  centrally in the API like every other entitlement (`recipientCap`, `autoSendEnabled`). Seeded
  **off for free**, **on for Pro and Centre**. The migration also flips the flag on for the
  existing `pro`/`centre` rows so production is consistent without a reseed.

### API

`POST /saved-designs` now has two branches:

- **With `cardDesignId`** — unchanged: copy the template's document (or an edited variant).
- **Without `cardDesignId`** — a custom design. A `document` is **required** (400 otherwise), and
  the account's plan must carry `customArtworkEnabled` (**403** otherwise, message pointing at the
  Pro/Centre plans). The design is stored with `cardDesignId: null`.

The gate lives in `SavedDesignsService.create` via `EntitlementsService.getForAccount`, so it can
never be bypassed from the client. The upload itself reuses the existing signed-URL endpoint
(`POST /uploads/design-assets` → Supabase Storage) — no new storage surface.

### Web

- `/designs` is restructured so **"My designs" is the first, prominent section**, with the template
  catalog beneath it.
- Subscribers see an **"Upload your own artwork"** button; free-plan accounts see an **"Upgrade to
  upload your own artwork →"** link to `/billing` instead. The page fetches
  `/accounts/me/entitlements` server-side to decide which to show.
- Uploading runs the same signed-upload → `uploadToSignedUrl` flow the editor uses for images, then
  creates a custom saved design whose document is a single **full-bleed image** (450×600) on the
  front page (inside/back left blank), and drops the member straight into the editor to finish it
  (add a message, reposition, add a QR).

## Consequences

- The entitlement gate is server-enforced; the web gating is only UX. A free-plan user who forges
  the request still gets a clean 403.
- Existing template-derived saved designs are unaffected — their `cardDesignId` is still set.
- The full-bleed default is a sensible starting layout, not a constraint: everything is editable in
  the Konva editor afterwards, so odd aspect ratios can be repositioned.
- Future work (not in this change): render an actual thumbnail for saved designs in the gallery
  (both template-derived and custom currently show an "Edit" placeholder tile).
