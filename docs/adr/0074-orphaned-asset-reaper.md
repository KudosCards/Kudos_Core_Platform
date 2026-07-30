# 0074 — Orphaned-asset reaper

## Status

Accepted

## Context

Uploaded artwork lives in the public `design-assets` Supabase Storage bucket.
Objects there accumulate with no way to reach them:

- **Abandoned uploads.** The designer takes a signed upload URL and the browser
  PUTs the file straight to Storage (the bytes never touch the API). If the user
  then closes the editor without saving to their library or into a design, the
  object exists but no DB row ever referenced it.
- **Deleted library entries.** Deleting a saved asset removes only the
  `DesignAsset` row — the storage object is left in place on purpose, because a
  design document may still embed the same url (ADR 0070). Once no design uses
  it either, it's dead storage.

Nothing ever cleaned these up, so the bucket only grows. We want a janitor that
reclaims them **without ever deleting a live object** — the cost of a false
delete (a card rendering a broken image) is far worse than leaving some dead
bytes around, so the whole design biases hard toward caution.

## Decision

**A scheduled reaper that deletes only what nothing references.** A new
`storage-maintenance` module walks the bucket and, for each object, keeps it
unless it is referenced by **no** DB record at all. References are gathered from
every url-bearing column: `DesignAsset.url`, `CardDesign.thumbnailUrl`, and any
url embedded in a `CardDesign` or `SavedDesign` `document` (documents are opaque
JSON, so we stringify and pull out every `design-assets/<path>` occurrence
rather than guessing the shape). Only objects matching nothing are candidates.

**Conservative by construction.** On top of "referenced ⇒ kept", four more
guards:

- **Ships dark.** It only ever deletes when `STORAGE_REAPER_ENABLED` is `true`
  (or `1`). Unset ⇒ the scheduled run is a logged no-op and a manual trigger
  runs in dry-run. Same "enable by adding a Railway var" pattern as Airtable /
  Royal Mail / Stripe.
- **Grace window.** An unreferenced object is only eligible once it's older than
  `STORAGE_REAPER_GRACE_DAYS` (default 7), so an in-progress upload or an edit
  that hasn't been saved yet is never reaped. An object whose age Storage can't
  report is treated as recent and left.
- **Never catalog artwork.** Objects under the `catalog/` prefix (managed by the
  catalog sync, which deliberately leaves deactivated images so historical
  designs keep rendering) are skipped outright.
- **Per-run cap.** At most 1000 deletions per run — a backstop so a hypothetical
  reference-extraction bug surfaces as something an operator notices, not a
  bucket wipe.

**Manual, dry-run-first ops endpoint.** `POST /storage-maintenance/reap`
(PlatformAdminGuard, Kudos-internal) defaults to a **dry run**: it reports
`{ scanned, referenced, recentlyUploaded, orphaned, deleted, capped, dryRun }`
so an operator can eyeball exactly what would go before trusting it. `?dryRun=
false` performs the deletion — which still requires the feature flag, so a
mis-click while disabled is a no-op. A nightly `@Cron` runs the same reaper.

**Mockable storage client, no test hits Supabase.** The reaper injects the same
`DESIGN_ASSET_STORAGE_CLIENT` used everywhere else, overridden in tests exactly
like `STRIPE_CLIENT` — it lists and removes through the client's `storage.from()`
API against an in-memory double.

## Consequences

- Dead storage is reclaimed automatically once enabled, keeping the bucket (and
  its bill) proportional to real artwork — while a live object is protected by
  four independent guards before anything is deleted.
- Enabling is a deliberate two-step: set `STORAGE_REAPER_ENABLED`, then run the
  endpoint as a **dry run** and read the report, then let the nightly cron take
  over (or run `?dryRun=false` once to reclaim immediately). Recommended before
  first enabling in production.
- The reference scan reads all `DesignAsset` / `CardDesign` / `SavedDesign` rows
  each run. At current scale that's trivial; if the catalog or design corpus
  grows very large, the scan (not the delete) is the first thing to page or
  index.
- Tests: a unit spec covers the decision logic (referenced-by-url and
  referenced-in-document are kept, within-grace is kept, catalog is skipped,
  disabled and dry-run delete nothing, past-grace orphan is deleted) and an e2e
  covers the ops endpoint — auth, the dry-run default, and a real
  Prisma-backed run that deletes the orphan while keeping the referenced object.
