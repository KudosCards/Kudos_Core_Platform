# 0163 — Catalog URLs: card slugs and crawlable category pages

## Status

Accepted — implemented across stages A, B and C (see "Staged delivery").

## Context

The public card library is the one genuinely large body of indexable content we
own, and it is currently invisible to search. Two structural reasons, from the
audit in `docs/seo-plan.md` (findings 10 and 11):

- **Card URLs are UUIDs.** `/cards/3f2a…` carries no keywords, can't be read
  aloud, and tells a crawler nothing about the page.
- **Categories have no URL at all.** Filtering in `cards-gallery-client.tsx` is
  React state, so "birthday cards", "thank you cards" and "congratulations cards"
  — the actual search demand for this product — have no landing page to rank.

Two constraints shaped the decision, both found while planning rather than while
writing code:

1. **Categories are uncontrolled upstream text.** `airtable-catalog-source.ts`
   takes Airtable's "Occasion" field, lowercases it, and falls back to
   `"uncategorised"` (line 139). There is no enum and no validation. A page per
   distinct category would publish `/cards/uncategorised` and mint a new indexed
   page for every typo or spelling variant ops introduces. The display helper
   (`category.charAt(0).toUpperCase()`) would also render `thank_you` as
   "Thank_you" to customers.

2. **`/cards/<category>` collides with `/cards/<card>`.** `app/cards/[id]`
   already matches any single segment, and Next can't have two differently-named
   dynamic segments at the same level. So the card URL shape and the category URL
   shape are one decision, not two — and each shape carries its own redirects, so
   settling it once is materially cheaper than shipping category pages now and
   moving them later.

## Decision

Adopt a two-level hierarchy where the category is the parent segment:

```
/cards                                        the library
/cards/birthday                               category landing page
/cards/birthday/simple-happy-birthday-fun     a card
308  /cards/<uuid>            → the card's new URL
308  /cards/<uuid>/send       → the card's new send URL
308  /cards/<card-slug>       → the card's new URL (hand-typed, no category)
308  /cards/<wrong-cat>/<slug> → the card's real category
```

### A curated category vocabulary, not whatever Airtable holds

`packages/shared-types/src/card-category.ts` owns the vocabulary: canonical slug
→ display name, plus the aliases that map upstream strings onto it (`thank you`,
`thank_you`, `thankyou` → `thank-you`).

- Only vocabulary categories get a landing page, a sitemap entry and a canonical.
- Anything else — a typo, a new occasion ops adds before we've named it,
  `uncategorised` — still syncs, still appears in the library, and is still
  browsable through the on-page filter. It simply publishes no indexable page.

This is the deliberate trade: adding a category becomes a one-line code change,
and in exchange an Airtable typo can never mint an indexed page or show a
customer "Thank_you". The vocabulary is also the single source of display names,
replacing the four separate `formatCategory` copies in the web app.

### Slugs are assigned once and never change

`slugifyCardName()` derives the slug from the design's name. The sync assigns it
**on create only**: renaming a card in Airtable updates the title but leaves the
slug alone.

A slug that tracked the name would silently break every indexed URL, inbound
link and QR-carrying card in the post the moment ops fixed a typo. Stability
matters more than tidiness here. Ops can still force a new slug deliberately, by
retiring the design and adding a new one.

Collisions get a numeric suffix (`-2`, `-3`) at assignment time, and the column
is `@unique` so the database is the backstop rather than the generator.

### Redirects, not rewrites

The old UUID URLs permanently redirect to the new ones. They are in Google's
index and on cards already posted, so they must keep working; a permanent
redirect also passes the ranking signal to the new URL, which a rewrite would
not.

The status code is **308, not 301** — that's what Next's `permanentRedirect()`
emits, and Google documents 308 as equivalent to 301 for ranking purposes (the
difference is that 308 preserves the request method, which is irrelevant for
these GET-only pages). Forcing a literal 301 would mean moving the redirect into
middleware or `next.config`, and neither can do the database lookup that turns a
UUID into its category and slug.

The same redirect also canonicalises a card reached under the _wrong_ category,
so one card is never served at two URLs.

## Staged delivery

Deliberately three PRs — a migration, an external sync change and a route
restructure in one diff would be hard to review and risky to revert.

- **A — Foundation.** `card-category.ts` (vocabulary, alias
  resolution, display names) and `slugifyCardName()`, with unit tests. Pure
  functions, no schema and no route changes, so nothing user-facing moves yet.
- **B — Data.** `CardDesign.slug` (nullable → backfill → unique, non-null),
  seed slugs, sync assigns slugs on create, and the API resolves a card by slug
  as well as by id.
- **C — Web.** `/cards/[category]/[slug]` and `/cards/[category]`, permanent
  redirects from the UUID routes, sitemap entries for categories and new card
  URLs, breadcrumbs and canonicals updated to match the hierarchy.

  Because `/cards/<uuid>` and `/cards/<category>` are the same route shape, the
  category page owns the legacy redirect: anything that isn't a published
  category is looked up as a card identifier and redirected, or 404s. The
  two-segment route does the same for the old `/cards/<uuid>/send`.

  Cards whose upstream category isn't in the vocabulary live under
  `/cards/other/<slug>`. They need exactly one canonical URL like any other card;
  without the fallback they would be orphaned, or their breadcrumb would point at
  a category page that 404s. The card pages there are indexable — only the
  grab-bag landing page itself is noindex, and it's kept out of the sitemap.

  A published category with no cards 404s rather than serving a thin empty page,
  and the sitemap lists only categories that actually have stock.

## Consequences

- Card and category URLs finally carry keywords, and every card gains an internal
  link from a category page rather than sitting behind a client-side filter.
- Adding a category is a code change. That is the point, but it does mean ops
  can't self-serve a new landing page — worth revisiting only if the category set
  starts changing often.
- Two extra dynamic segments to keep canonical: a card reachable under the wrong
  category redirects to its real one, or the same content becomes reachable at
  several URLs.
- The `uncategorised` bucket stays invisible to search by design. If a meaningful
  number of cards land there, that is an upstream data problem to fix in
  Airtable, not something to paper over with a landing page.
