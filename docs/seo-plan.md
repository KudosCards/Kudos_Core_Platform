# SEO Plan

Status: **Phases 1–6 shipped in code** (1–4 on 2026-08-17, 5–6 on 2026-08-18). What's left is
ops, not code: Phase 0's DNS and Search Console setup, the `LIGHTHOUSE_BASE_URL` repo variable,
and watching Search Console coverage once the sitemap is submitted.
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
    matcher's file-extension rule doesn't catch it because the OG image is a _route_, not a
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

- **Phase 4 — Catalog URLs and category pages. ✅ Done (ADR 0163).** Shipped in three
  stages so a migration, an external sync change and a route restructure didn't land as one
  diff: **A** the category vocabulary and slug derivation, **B** `CardDesign.slug` plus the
  backfill, sync and API, **C** the `/cards/<category>/<slug>` routes, redirects and sitemap.

  Two constraints found while planning changed the shape of the work. Categories are
  uncontrolled upstream text — the Airtable sync lowercases the "Occasion" field and falls
  back to `uncategorised` — so a page per distinct category would have published
  `/cards/uncategorised` and a page per typo; hence a curated vocabulary. And
  `/cards/<category>` collides with the old `/cards/<uuid>`, since Next can't have two
  differently-named dynamic segments at one level, which made the card URL shape and the
  category URL shape a single decision.

  The migration was **run against a real Postgres 16**, not just written: its SQL slugify was
  compared row-for-row against `slugifyCardName()` over adversarial rows (accents,
  ampersands, apostrophes, duplicate names, a name of only symbols) before being committed —
  0 divergences. Accent folding uses `translate()` over Latin-1 rather than the `unaccent`
  extension, which isn't guaranteed on the managed database and would fail the migration at
  deploy time.

  Redirects are **308 rather than 301** — that's what Next's `permanentRedirect()` emits, and
  Google treats it as equivalent; a literal 301 would need middleware, which can't do the
  lookup that turns a UUID into a category and slug. The same path canonicalises a card
  reached under the wrong category, so one card is never served at two URLs.

  Cards whose category isn't in the vocabulary live at `/cards/other/<slug>` — indexable
  pages under a noindex landing page, because every card needs exactly one canonical URL and
  the alternative is orphans or breadcrumbs pointing at a 404.

- **Phase 5 — Content layer. ✅ Done.** The slow-burn phase that actually earns non-brand
  traffic.

  **Authoring mechanism — decided (ADR 0164): typed TypeScript content modules, not MDX and
  not a CMS.** The content turned out to be structures with a repeated shape (question/answer
  pairs; headline + pains + proof + CTA), which is what `lib/legal/*.ts` already does for a
  far more sensitive document. The decisive argument was Phase 3's: marketing copy that
  quotes a number is a _copy_ of that number, and Phase 3 caught two price claims that
  contradicted checkout. In a TS module the number interpolates from `CARD_PRICE_MINOR`,
  `POSTAGE_MINOR` or `PLAN_CATALOG`; in MDX or a CMS it's hand-typed and nothing checks it.
  The cost — a developer for every copy change — is accepted and revisitable.

  **`/faq` — done.** Fourteen answers, every number derived from a constant, every claim
  traceable to a plan entitlement, a pricing constant or an ADR. FAQPage JSON-LD is generated
  from the same strings the page renders, so marked-up and visible text cannot diverge. Note
  what this markup does _not_ buy: since 2023 Google shows FAQ rich results only for
  government and health sites, so the value is machine-readable content, not SERP real estate.

  Two claims were cut in review rather than published. "We don't sell your data" is a policy
  commitment the privacy policy doesn't make — the FAQ is the wrong place to invent one. And
  the approval lead time was left unquantified because `BIRTHDAY_LOOKAHEAD_DAYS` lives in the
  API and the web can't import it, so a figure here would have been a hand-typed copy of
  exactly the kind this ADR exists to prevent.

  **Audience pages — done.** Seven pages at `/for/<audience>`, one behind each "Used by" pill,
  plus a `/for` hub so they're one click from each other rather than each having a single entry
  point. The pills themselves now render from `AUDIENCES`, so the homepage can't list an
  audience that has no page.

  The risk here was doorway pages — the homepage with one noun swapped is exactly what search
  engines look for — so the pages were checked for it rather than assumed clean: shared 6-word
  phrases across the seven bodies were **measured**, four templated sentences found and
  rewritten, and the count fell from ~100 to 4. What survives is unavoidable product vocabulary
  ("names, addresses and dates of birth"). What differs is substantive: a club sends on
  renewals, a school sends at year-group scale and needs shared logins, a charity's moment is
  the thank-you after a donation.

  **Occasion guides — done.** Four "what to write in a ... card" guides at `/guides/<slug>`,
  with a `/guides` hub, mapped one-to-one onto the card categories they send readers to
  (birthday, thank-you, congratulations, achievement). Each category page links back at its
  guide, so the informational page and the commercial page point at each other.

  The obvious version of this page — a generic "what to write in a birthday card" — is written
  by every card retailer online and would pull consumer traffic with no use for a platform that
  posts cards for a tuition centre. So the guides answer the question _this_ product's visitors
  have: what do you write to a customer, a student, a donor, a club member, where the tone
  going wrong is a business problem. Every example is written for that setting, and uses the
  real `{firstName}` merge token, which is also the thing that makes the wording sendable
  rather than just readable.

  One group exists that a retailer's guide wouldn't have: **what to write when the exam results
  weren't what they hoped for.** It's the card a tuition centre most needs help writing.

  Article markup carries `datePublished`/`dateModified` from the guide's own `updated` field.
  Deliberately not backdated to look established — a false date in a machine-readable field is
  the worst place to put one.

  **Phase 5 is complete.** **Guardrail applied throughout:** no invented statistics or
  testimonials, and no claims about which wording "performs" — nobody here has measured that.

- **Phase 6 — Hygiene and monitoring. ✅ Code half done; the rest is ops.**

  The Lighthouse workflow now asserts SEO, via `.github/lighthouse/lighthouserc.json`. The
  assertions are **`warn`, never `error`** — the workflow runs weekly against the live site, so
  a red run means "go and look", not "someone's PR is broken", and that's the same reason the
  perf numbers aren't a gate either.

  Two decisions worth keeping: the config asserts the **individual audits** (`canonical`,
  `document-title`, `meta-description`, `is-crawlable`, `crawlable-anchors`, `http-status-code`)
  and not just `categories:seo ≥ 0.95`, because a 0.95 category score is reachable with the
  canonical tag missing — the exact thing Phases 1–4 spent their time getting right. And the
  profiled set is **one URL per page template**, not per page: home, catalog, FAQ, an audience
  page, a guide. All five are statically generated and independent of catalog contents, so a
  run can't go red because the card sync returned nothing.

  This was verified by running Lighthouse locally rather than by reading the docs, which was
  worth doing three times over. The workflow had **no `actions/checkout` step**, so the config
  file would not have existed on the runner. An unknown audit id turns out to be reported
  rather than ignored (confirmed by asserting a deliberately bogus one), so the seven ids are
  known-good. And asserting a `noindex` page proved the warnings actually fire and still exit 0
  — while turning up a real gap: the guest send page had no meta description, now fixed.

  **Still ops, not code:** watch Search Console coverage for the noindex/canonical rules
  actually landing, and re-check the sitemap after any catalog sync change.

## Rules for a new public page

The checklist Phase 6 asks to keep. Anything reachable without logging in needs all of these,
and every one of them has already been got wrong at least once in this repo:

1. **Add it to `isPublicPath`** (`lib/supabase/proxy.ts`). Miss this and it 307s a logged-out
   visitor — and every crawler — to `/login`. Found three times: `/enterprise`, `/terms`,
   `/privacy` and the whole `/rts/` flow were all unreachable this way.
2. **Add it to `sitemap.ts`.** A page nothing links to and the sitemap doesn't list is invisible.
3. **One `<h1>`**, and a `<title>` that isn't a duplicate of another page's.
4. **`alternates.canonical`**, or the page competes with its own query-string variants.
5. **`openGraph: openGraphFor({...})`**, not a bare `openGraph` object — Next merges metadata
   _shallowly_, so a page-level `openGraph` silently replaces the parent's `siteName`,
   `locale` and `type` rather than extending them.
6. **A meta description.** Even on a `noindex` page: people share URLs, and a link preview
   with nothing under the title reads as broken.
7. **Alt text on every image**, and `priority` on the one that's the LCP.
8. **Numbers in the copy come from constants**, never typed by hand (ADR 0164). Two customer-
   facing price claims contradicted checkout before that rule existed.
9. **If it's `noindex`, don't also `Disallow` it in robots.txt** — a blocked crawl never reads
   the noindex, so the page can still be indexed from external links.
10. **Then load it logged out and read the HTML.** Every bug in this list was found that way,
    not by a green build.

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
