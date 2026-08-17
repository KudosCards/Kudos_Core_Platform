# SEO Plan

Status: **not started** — this is the audit + phased plan, written 2026-08-17 against
`main` at the marketing-page rework (#297–#302).

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

- **Phase 1 — Crawl basics.** The quick win: small, self-contained, no product decisions.
  - `app/robots.ts` — allow the public surface, disallow `/r/`, `/gift/`, `/rts/`,
    `/invite`, `/basket`, `/auth/`, `/admin-login`, `/admin-set-password` and the authed
    app routes; point at the sitemap.
  - `app/sitemap.ts` — homepage, `/cards`, every card detail page, `/enterprise`,
    `/terms`, `/privacy`. Read the catalog through `publicApiFetch` with the same
    `CATALOG_REVALIDATE_SECONDS` the pages use. **Must degrade to the static routes if the
    API is unreachable**, mirroring how `generateStaticParams` already tolerates that —
    a sitemap must never fail a build.
  - `metadataBase` from `NEXT_PUBLIC_SITE_URL` (fall back to the production origin so a
    missing env var can't emit relative canonicals).
  - `alternates.canonical` on every public page.
  - `robots: { index: false, follow: false }` on the finding 7 + 8 routes. **Do finding 7
    first and separately if anything slips** — it's the privacy item.

- **Phase 2 — Metadata and social cards.** Real `title`/`description` on the homepage
  written for search rather than for the boardroom, and titles for the auth and legal
  pages. A `title.template` on the root layout (`"%s — Kudos Cards"`) so per-page titles
  stop repeating the suffix by hand. `openGraph` + `twitter` blocks, a static
  `opengraph-image` for the marketing pages, and a dynamic one for `/cards/[id]` rendering
  the card's own artwork — that last one is what makes a shared card link look like a card.

- **Phase 3 — Structured data.** JSON-LD, server-rendered, no library needed.
  Organization (with the real registered details already in
  `lib/legal/privacy.ts` — Kudos Cards Ltd, company 16349929, Darlington DL1 1GB),
  BreadcrumbList on card and category pages, and Product + Offer on `/cards/[id]`.
  **Guardrail:** Offer markup must match what we actually charge — `CARD_PRICE_MINOR` is
  £2.50 incl. VAT, plan discounts are 10%/15%, and postage (£1.80 1st, £0.91 2nd) is
  charged per card on top. Marking up a price that checkout then contradicts risks the
  rich result being pulled, so derive it from `packages/shared-types/src/pricing.ts`
  rather than hard-coding, and state that postage is additional. FAQPage lands with the
  FAQ page in Phase 5.

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
