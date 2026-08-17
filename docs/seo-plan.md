# SEO Plan

Status: **Phases 1–3 shipped 2026-08-17.** Phase 0 (the ops half) and Phases 4–6 remain.
Audit written against `main` at the marketing-page rework (#297–#302).

Kudos Cards sells a search-driven product ("birthday cards for schools", "thank you cards
UK", "automated birthday cards for business") but the platform currently ships **no
robots.txt, no sitemap, no canonical URLs, no social cards and no structured data**, and
the homepage has no `metadata` of its own at all. The card library — the one genuinely
large body of indexable content we own — sits behind UUID URLs with no crawlable category
pages.

Nothing here is a rewrite. Phase 1 is a handful of small files and is where most of the
risk reduction lives. The expensive phases (4 and 5) are the ones that actually grow
traffic, and they need product decisions, not just code.

Scope note: page-speed work is tracked separately in `docs/performance-backlog.md` and is
not duplicated here. Core Web Vitals are a ranking input, so the two plans support each
other — but only Phase 0's measurement overlaps.

## Findings (what's actually wrong today)

| #   | Finding                                                                                                                                                                                                                                                                     | Where                                 | Impact                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------ |
| 1   | **No `robots.txt`** — no crawl directives, and no pointer to a sitemap.                                                                                                                                                                                                     | no `app/robots.ts`                    | High, trivial            |
| 2   | **No `sitemap.xml`** — every SSG'd card page is discoverable only by crawling the gallery grid.                                                                                                                                                                             | no `app/sitemap.ts`                   | High, trivial            |
| 3   | **The homepage has no `metadata` export.** It inherits the root title `"Kudos Cards"` and the description "Automated, personalised physical recognition that builds retention and loyalty." — no keywords, and it reads like an internal pitch rather than a search result. | `app/page.tsx`, `app/layout.tsx:15`   | High, trivial            |
| 4   | **No `metadataBase`**, so any canonical or OG URL we add later resolves relative and breaks.                                                                                                                                                                                | `app/layout.tsx`                      | High (blocks 5, 6)       |
| 5   | **No canonical URLs anywhere.** Both apex and `www` are trusted origins, so the same page is reachable on two hosts with nothing telling Google which wins.                                                                                                                 | all pages; `apps/api` CORS allow-list | High                     |
| 6   | **No OG/Twitter metadata and no `opengraph-image`.** Every link shared on WhatsApp, Facebook or LinkedIn — the channels this product actually spreads through — renders as bare text.                                                                                       | none in `app/`                        | High                     |
| 7   | **Recipient message pages are indexable.** `/r/[slug]` renders a personal message to a named recipient with no `noindex`. This is a privacy problem first and an SEO one second.                                                                                            | `app/r/[slug]/page.tsx`               | High (privacy)           |
| 8   | Transactional/dead-end pages are also indexable: `/basket`, `/gift/success`, `/gift/cancelled`, `/gift/claim`, `/rts/[token]`, `/invite`, `/admin-login`, `/admin-set-password`, `/auth/*`.                                                                                 | those routes                          | Medium                   |
| 9   | **No structured data at all** — no Organization, no Product/Offer on card pages, no BreadcrumbList, no FAQPage. No eligibility for any rich result.                                                                                                                         | whole app                             | Medium–High              |
| 10  | **Card URLs are UUIDs** (`/cards/3f2a…`) — no keywords, unmemorable, unshareable.                                                                                                                                                                                           | `app/cards/[id]`, `cardDesignSchema`  | High (needs data change) |
| 11  | **No crawlable category pages.** Category filtering is React state in the gallery, so "birthday cards", "thank you cards", "congratulations cards" have no landing page and no URL.                                                                                         | `cards-gallery-client.tsx:52`         | **Highest opportunity**  |
| 12  | **No content layer** — no FAQ, no guides, no audience pages. The "Used by" pills (Businesses, Tuition Centres, Schools, Sports Clubs, Charities, Care Teams, Individuals) are a keyword map with no pages behind them.                                                      | `app/page.tsx:21`                     | High (slow burn)         |
| 13  | Auth and legal pages have thin or default titles; `/login`, `/register`, `/forgot-password`, `/reset-password` have no `metadata`.                                                                                                                                          | `app/(auth)/*`                        | Low                      |
| 14  | The Lighthouse workflow's setup comment names `https://kudoscards.co.uk` (no hyphen) while the canonical site is `kudos-cards.co.uk`. Measurement may be pointed at the wrong host, or at nothing if `LIGHTHOUSE_BASE_URL` is unset.                                        | `.github/workflows/lighthouse.yml:11` | Low, trivial             |

**Already good — leave alone.** Exactly one `<h1>` on every public page. `/cards`,
`/cards/[id]` and `/cards/[id]/send` are ISR with `generateStaticParams` (ADR 0044), so
the catalog is CDN-served, statically rendered and crawler-friendly — the hard part is
already done. `next/image` is used throughout with `remotePatterns` configured (ADR 0045).
Alt text on the marketing images is descriptive. `lang="en"` is set. The
`netlify.app` → custom-domain 301 is in place (ADR 0080).

## Phases

- **Phase 0 — Decide the canonical host, then measure.** Pick apex or `www` (recommend
  apex, `https://kudos-cards.co.uk`, since that's what `netlify.toml` and `WEB_APP_URL`
  already use) and add a `force`d 301 for the loser alongside the existing `netlify.app`
  redirect. Set `NEXT_PUBLIC_SITE_URL` in the Netlify environment — `lib/env.ts` already
  accepts it — and set `LIGHTHOUSE_BASE_URL` to the same value. Fix finding 14. Verify
  Search Console for the chosen property, submit nothing yet, and screenshot the baseline
  (indexed pages, impressions, queries) so later phases can be judged against it.
  _Nothing ships to users in this phase; it's the prerequisite for 1 and 2._

- **Phase 1 — Crawl basics. ✅ Done.** `app/robots.ts` and `app/sitemap.ts` (the sitemap
  falls back to the marketing routes when the catalog API is unreachable, so it can never
  fail a build); `metadataBase` + `SITE_URL`/`absoluteUrl`/`NO_INDEX` in `lib/site.ts`;
  `alternates.canonical` on the six indexable public pages; `noindex, nofollow` on
  `/r/[slug]`, `/basket`, `/gift/*`, `/rts/[token]`, `/invite/[token]` and
  `/cards/[id]/send`.

  Two corrections to the plan as written, both found by actually fetching the routes:

  - **The proxy swallowed both new files.** `src/proxy.ts`'s matcher didn't exclude
    `robots.txt` or `sitemap.xml`, so the Supabase session middleware treated them as app
    routes and 307'd them to `/login`. Shipping the files without this fix would have
    achieved nothing. Now excluded in the matcher (no session to refresh on either).
  - **`/enterprise`, `/terms`, `/privacy` and `/rts/*` were never in the proxy's public
    path list**, so logged-out visitors and crawlers were bounced to `/login`. That's a
    functional bug beyond SEO: the footer's legal links were unreachable when signed out,
    and ADR 0039 specifies `/rts/:token` as a "public, no-login recovery page" reached
    from the RTS email. Added to `PUBLIC_PATHS` / `isPublicPath`.

  Not done here, deliberately: the plan listed `/r/`, `/gift/`, `/rts/`, `/invite` and
  `/basket` as robots.txt `Disallow` entries. They're handled with per-page `noindex`
  instead — a `Disallow` stops the crawl, which means the crawler never sees the noindex
  and the URL can still be indexed from an inbound link. `robots.ts` carries the reasoning.
  `/onboarding`, `/auth/confirm`, `/admin-login` and `/admin-set-password` are client
  components and can't export `metadata`, so those rely on the robots.txt rules alone.

- **Phase 2 — Metadata and social cards. ✅ Done.** `title.template` (`"%s — Kudos Cards"`)
  on the root layout, so the nine pages that hard-coded the suffix now set just their page
  name. Homepage `title`/`description` rewritten for a search result. Root `openGraph` +
  `twitter` blocks and a branded `app/opengraph-image.tsx` (generated with `next/og`, no
  custom font so the build has no font-fetch dependency). Auth pages got titles via a
  one-child `layout.tsx` per route — they're client components and can't export `metadata`,
  and a metadata-only layout is far cheaper than splitting each auth form into a server
  wrapper. `/forgot-password` and `/reset-password` are noindex while at it.

  Two corrections, again found by fetching rather than by building:

  - **`/opengraph-image` 307'd to `/login`** — the same proxy trap as Phase 1, but the
    matcher's file-extension rule doesn't catch it because the OG image is a *route*, not a
    file. Every shared link would have had no preview image. `opengraph-image` and
    `twitter-image` are now named in the matcher.
  - **Next merges metadata shallowly**, so any page setting its own `openGraph` replaced the
    root's object outright and silently dropped `og:site_name` and `og:locale`. Page-level
    OG now goes through `openGraphFor()` in `lib/site.ts`, which fills the shared fields in.

  `/cards/[id]` sets its `openGraph.images` to the card's own `thumbnailUrl` rather than
  generating a composite: a real card front is the better share image, and it keeps the OG
  route off the network path at build.

- **Phase 3 — Structured data. ✅ Done.** Server-rendered JSON-LD, no library:
  `lib/structured-data.ts` builds the payloads and `components/json-ld.tsx` renders them
  (escaping `<` so a value can never break out of the script tag). Organization + WebSite on
  the homepage, using the registered details we already publish (Kudos Cards Ltd, company
  16349929, Darlington DL1 1GB) with the company number as an `identifier`, not a `taxID`.
  BreadcrumbList on `/cards` and `/cards/[id]`. Product + Offer on `/cards/[id]`.

  The Offer prices the **card alone** (`CARD_PRICE_MINOR`, £2.50 incl. VAT) and declares the
  stamp separately as `OfferShippingDetails` at the second-class rate (£0.91) — the class the
  guest basket actually applies. Both come from `pricing.ts`, so neither can drift from
  checkout. £2.50 + £0.91 is exactly what a guest pays for one card.

  **The guardrail earned its place.** Checking what checkout charges before writing the
  markup turned up two customer-facing claims that were simply wrong: `/cards/[id]/send`
  said "£2.50, all in" and its form said "£2.50 a card includes VAT & UK postage", while
  `basket-client.tsx` adds `POSTAGE_MINOR.second_class` per card and charges £3.41. Both
  strings are now derived from the constants and state the stamp separately. Marking up
  "includes postage" would have enshrined a price the basket contradicts.

  FAQPage still lands with the FAQ page in Phase 5. No review/aggregateRating markup — see
  "explicitly not doing".

- **Phase 4 — Catalog URLs and category pages.** The structural work, and the biggest
  single opportunity. Needs an ADR.
  - Add a `slug` to card designs (unique, derived from `name`, backfilled; the catalog
    already carries `sku` and `externalId` from Airtable, so decide whether slug is
    authored upstream or generated on sync). Serve `/cards/<slug>`, 301 the UUID form so
    existing links and any indexed URLs survive.
  - Real category routes — `/cards/birthday`, `/cards/thank-you`, `/cards/achievement`,
    `/cards/academic`, `/cards/funny` — statically generated from the catalog's distinct
    categories, each with its own `h1`, copy, metadata and canonical. Keep the client-side
    filter for in-page browsing, but make each category addressable.
  - Internal linking: category → card, card → related cards in the same category,
    breadcrumbs throughout. This is what turns hundreds of thin pages into a crawlable
    structure instead of an orphan pile.
  - Retired designs need `410` (or a 301 to their category) rather than a soft 404.

- **Phase 5 — Content layer.** The slow-burn phase that actually earns non-brand traffic.
  Audience pages behind the "Used by" pills (tuition centres, schools, sports clubs,
  charities, care teams) — each a real page with its own proof and CTA, not a doorway
  variant of the homepage. Occasion guides. A genuine FAQ page (+ FAQPage markup). Decide
  the authoring mechanism first: MDX in-repo is the cheapest thing that works and keeps
  content in review; a CMS is only worth it if non-engineers will write. **Guardrail:** no
  invented statistics or testimonials — the same rule the homepage now follows, where the
  hero stat had to become the published "100+" figure and the timeline was left
  deliberately number-free.

- **Phase 6 — Hygiene and monitoring.** Add Lighthouse's SEO category to the existing
  workflow and assert it stays ≥ 95 on the public pages (non-blocking, like the perf
  numbers). Watch Search Console coverage for the noindex/canonical rules actually
  landing. Re-check the sitemap after any catalog sync change. Keep the one-`h1`,
  alt-text and canonical rules in the review checklist as new pages get added.

## Sequencing and effort

| Phase | Effort          | Payoff                                         | Blocked by  |
| ----- | --------------- | ---------------------------------------------- | ----------- |
| 0     | ~1h             | Prerequisite                                   | —           |
| 1     | ~half a day     | Fixes a privacy leak; makes the site crawlable | 0           |
| 2     | ~1 day          | Better CTR, shareable links                    | 0, 1        |
| 3     | ~1 day          | Rich-result eligibility                        | 1           |
| 4     | ~3–5 days + ADR | Largest organic upside                         | 1, 3        |
| 5     | ongoing         | Non-brand traffic                              | 4 (ideally) |
| 6     | ~2h             | Keeps it from rotting                          | 1–4         |

Phases 1–3 are safe to ship in one PR each and in order. Phase 4 should not start before
the canonical host is settled (Phase 0) — changing URL shape twice would waste the 301s.

## Explicitly not doing

- **hreflang / i18n** — UK-only product, single language. Adds machinery for nothing.
- **Indexing the app surface** (`(app)`, `(ops)`, onboarding). It's behind auth; a crawler
  gets a redirect. Leave it.
- **Prerendering services / dynamic rendering.** The public pages are already statically
  rendered — this would solve a problem we don't have.
- **Keyword-stuffed doorway pages** per town or per school name. It's the obvious next
  idea after Phase 5 and it's the one that gets a site penalised.
- **Marking up review stars from the homepage testimonials.** Review rich results require
  a genuine, on-site review system with real aggregate data; three hand-picked quotes
  aren't that.
