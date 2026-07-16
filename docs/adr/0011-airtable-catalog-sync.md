# ADR 0011 — Airtable-sourced card catalog

Status: accepted
Date: 2026-07-16

## Context

The card catalog (`CardDesign`) shipped in Phase 2 with three hand-seeded placeholder
templates. But Kudos's real products — the professionally designed cards a tuition centre
actually orders — are authored and managed by the Kudos team in **Airtable** (base
"Kudos Cards - Card Management", table "Card List": Card SKU, Card Title, Occasion, Front Image,
Inside Message, Canva Link, Status, …). Until the catalog reflects those real designs there is
nothing meaningful to test the ordering flow with, and the platform can't go live.

Two decisions were confirmed with the user before building:

1. **Pick, then edit on canvas.** The Airtable artwork is not a finished, locked product — it
   becomes the *background* of an editable `DesignDocument`, so the existing Konva editor stays
   central and a centre can still personalise a card before ordering.
2. **Live sync, Airtable as source of truth.** The team keeps managing products in Airtable; the
   platform pulls from it, rather than the catalog being re-keyed by hand in a second place.

## Decisions

**Airtable is the upstream source; `CardDesign` is a synced projection of it.** A sync reads the
"Active" cards from Airtable and upserts them into `CardDesign`. Each design carries the Airtable
record id in a new unique `external_id` column (plus the human `sku`), so the sync is **idempotent**
— re-running updates in place, never duplicates. Seeded templates have `external_id = null` and are
never touched by the sync.

**The runtime never depends on Airtable.** Customer-facing catalog reads (`GET /card-designs`) hit
our own Postgres, exactly as before — fast, always available, and unaffected if Airtable is down.
Airtable is touched only during a sync.

**Artwork is copied into our own storage, not linked.** Airtable attachment URLs are **short-lived**
(they expire after a couple of hours). Linking them would leave the catalog full of dead images. So
the sync downloads each Front Image and re-uploads it to our Supabase `design-assets` bucket under a
stable per-card path (`catalog/<recordId>.<ext>`), and it is that permanent public URL we persist —
both as the `thumbnailUrl` and as the background `image` element in the editable document.

**The source adapter is injectable and mocked in tests.** `CATALOG_SOURCE` is a token bound to
`AirtableCatalogSource` via a factory (env-driven), following the exact pattern of `STRIPE_CLIENT` /
`JWKS_RESOLVER`. This build/CI environment has no network path to Airtable, so every test overrides
the token with a fake — no test ever reaches Airtable. The adapter owns all Airtable-specific
concerns: pagination, Status filtering, tolerant (case-insensitive, aliased) field matching so a
minor column rename doesn't silently break the sync, and normalisation (lowercased category,
dropping "Blank"/"–" placeholder inside-messages).

**Sync is an ops-only action, plus a nightly schedule.** `POST /catalog/sync` (and
`GET /catalog/status`) sit behind `PlatformAdminGuard` — the same internal-actor axis as
fulfillment (ADR 0010); a tuition-centre customer can't trigger it. The ops UI exposes a "Refresh
catalog from Airtable" button that reports a per-run summary (created / updated / deactivated /
images copied / per-card errors). A nightly `@Cron` runs the same sync so the catalog stays fresh
without anyone remembering to click; it no-ops with a log line when Airtable isn't configured.

**Retire, don't delete.** A card no longer Active upstream is set `isActive = false`, not deleted —
any `SavedDesign` a customer already derived from it keeps its foreign key. Deactivation is
**skipped entirely when a sync returns zero cards**, so a transient empty Airtable response can't
blank the whole catalog.

**Canva Link is deferred.** The editable Canva URL is the print team's high-res source, not
customer-facing content, so it is deliberately *not* synced into the customer catalog yet. It plugs
into the ops/fulfillment side later without touching this model.

## Alternatives considered

- **Proxy Airtable at read time** (no local copy) — rejected: couples every customer catalog view to
  Airtable's availability and rate limits, and can't serve expiring attachment URLs.
- **Store Airtable attachment URLs directly** — rejected: they expire within hours, so the catalog
  would rot. Copying the bytes into our own bucket is the only durable option.
- **One-time import script** — rejected by the "live sync" decision: the team edits products in
  Airtable continuously; a script that has to be re-run by a developer each time isn't operable by
  the business.
- **Match on SKU instead of record id** — rejected as the primary key: a SKU can be edited in the
  sheet, which would orphan the row and create a duplicate. The immutable Airtable record id is the
  safe upsert key; SKU is carried for display only.

## Operability hardening (from live bring-up)

Bringing the first real catalog online surfaced several operator-facing failure
modes. Each was fixed to fail loudly and, where possible, self-heal — an ops
tool that can't tell you *why* it failed, or needs precise manual setup, isn't
finished:

- **Real Airtable errors surface, not a generic 500.** A failed fetch is
  rethrown as a `502` carrying the reason, and the source maps the HTTP status
  to an actionable hint (401 → token invalid/regenerated, 403 → token lacks base
  access, 404 → base/table not found, 422 → table-name mismatch, 429 → rate
  limited). On a 403/404 it uses the `schema.bases:read` scope to **list the
  base's actual tables** in the error, so a wrong `AIRTABLE_CARDS_TABLE` names
  the fix itself. (The default table name was taken from an Airtable *interface
  page* — "Card List" — not the underlying table; the table id `tbl…` is the
  robust value to configure.)
- **The storage bucket is self-created.** The sync calls `createBucket(design-
  assets, public)` with the same client the uploads use, so a missing,
  mis-named, or wrong-project bucket can't turn every artwork copy into "Bucket
  not found". Idempotent; ensures the bucket is public so thumbnails render.
- **Artwork is copied concurrently.** A few hundred sequential download+upload
  round-trips ran long enough that the HTTP request dropped before responding
  (surfacing in the browser as a spurious CORS/`ERR_FAILED`). Copies now run
  with bounded concurrency (8) and a per-download timeout, so a full catalog
  syncs in seconds. For a catalog in the thousands the next step is a background
  job with status polling — deferred until the volume warrants it.
- **The customer Designs page filters by category**, rather than rendering the
  whole library as one ungrouped grid, now that the catalog is full.

## Consequences

- The catalog now reflects the real product library, managed where the team already works, and the
  ordering flow finally has genuine cards to exercise.
- A new env surface (`AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, optional `AIRTABLE_CARDS_TABLE`) must be
  set in production; absent it, the sync cleanly reports "not configured" and the app still boots.
- The sync re-copies each active card's artwork on every run (simple and correct for a catalog of
  hundreds; if the library grows large, a future optimisation can skip unchanged images by tracking
  the source attachment identity).
- `CardDesign` gains `external_id` (unique) and `sku`; both are nullable so seeded templates and any
  future non-Airtable designs coexist with synced ones.
