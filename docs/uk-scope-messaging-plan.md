# Saying what we actually serve

Analytics for the week to 19 September: 71 active users in the United Kingdom,
**40 in the United States**, then India 4, Afghanistan 2, Singapore 2, UAE 1,
Armenia 1. A third of the audience is outside the UK, and the SEO work
(`docs/seo-plan.md`, Phases 1–6) is what put them there.

Whether that traffic is people or crawlers changes how much it is worth. It does
not change whether the work is right, because everything below is either true
today and unsaid, or wrong today and quietly waiting for the first international
customer.

**But we cannot currently answer that question, and the reason is worth its own
sentence.** `docs/seo-plan.md` shipped six phases of SEO work and its status line
still reads: _"What's left is ops, not code: Phase 0's DNS and Search Console
setup … and watching Search Console coverage once the sitemap is submitted."_
Phase 0 is the **measurement** phase, and it never happened. We built the
robots.txt, the sitemap, the canonicals, the structured data and the content
layer, and then judged the result by Google Analytics sessions — which cannot
tell us which queries earn impressions, from which countries, on which pages.

That is S0 below, it is an hour of nobody's code, and it decides everything
after S5.

## The thing to get right

**We post to UK addresses. We do not only serve UK customers.**

Those are different sentences, and the second one is the commercially
interesting one. Somebody in New York can send a card to their mother in Leeds,
their UK client, or their London team. Nothing stops them — and this is checked,
not assumed:

- **Checkout takes any country.** `batch-orders.service.ts:1530` creates the
  Stripe session with no `allowed_countries` and no
  `billing_address_collection` restriction; the same is true of the wallet and
  subscription sessions.
- **Sign-up never asks.** `register/page.tsx` collects first name, last name,
  company, email, password. No country, no postcode.

So the constraint is on the **delivery address only**. Today's silence does not
overstate our market — it understates it, while leaving the people it does not
suit to find out the hard way.

## What is true today

### The site does not say it until it refuses

Across every customer-facing string in `apps/web`, "UK" appears in marketing
copy **twice**: one audience page's body text (`lib/audiences.ts:392`) and one
FAQ answer about bank holidays (`lib/faq.ts:122`). The homepage `title`,
`description` and OpenGraph description do not mention it at all
(`app/page.tsx:33–42`).

The first time a visitor from outside the UK learns is at the address field,
after signing up and choosing a card:

> **"That doesn't look like a valid UK postcode."** — `address-modal.tsx:50`

That is a dead end delivered at the worst possible moment, and phrased as
**their** mistake. They did not mistype. They did not know, because we did not
say.

### The structured data is silent on territory

`structured-data.ts` sets `inLanguage: "en-GB"` and a GB postal address for the
company. Neither says who we serve — `inLanguage` is a language signal, and a
registered office is not a service area. There is no `areaServed`.

The file's own stated rule is to never assert anything the product does not do.
It is not breaking that rule; it is simply silent where it could be exact.

### "Postable" does not currently mean postable

This one is not copy, and it is the reason this plan is worth doing even if
every one of those 40 users is a crawler.

`MISSING_ADDRESS_WHERE` (`recipients.service.ts:73`) is the **single**
definition of a mailable address — deliberately so, per ADR 0067, and used by:

- the dashboard's "needs address" count (`dashboard.service.ts:89`)
- the contacts list filter (`recipients.service.ts:345`)
- the smart-list `hasMailableAddress` rule (`segments.service.ts:491`)
- the CRM sync readiness panel (`recipients.service.ts:1044`)

It checks line 1, town and postcode. **It does not check the country.**

Send time does: `batch-orders.service.ts:675` flags
`Non-UK address (${addressCountry})` and excludes those recipients from the
charge — correctly, and with a named reason.

So a contact with a complete US address is counted as ready everywhere, and
refused at the end. Today that is nearly invisible, because almost every contact
is GB and the UK-only `AddressFields` block cannot produce anything else. A
non-UK address arrives one way: a CRM sync, which carries the provider's own
country value.

Which means the first customer to sync a mixed or international CRM sees
"497 contacts ready to send", pays for nothing, and gets 497 refusals. That is
not a message problem. That is the readiness panel telling them something untrue
at exactly the moment they are deciding to trust us.

## Decisions

**D1 — Say it on the way in, not at the point of refusal.** The cost of saying
it early is that some visitors leave sooner. They were going to leave anyway,
having first spent ten minutes and given us their email.

**D2 — Frame it as delivery scope, never as customer scope.** "Posted to UK
addresses" and not "UK customers only". The second is untrue and turns a
qualified buyer away.

**D3 — One definition of postable, and it must include the country.** Fixing
this in `MISSING_ADDRESS_WHERE` rather than at each call site is the whole point
of ADR 0067 having one definition.

**D4 — No geo-detection, ever.** The obvious idea is a banner for non-UK IPs.
It is wrong twice: a US visitor may be exactly the right customer, and it
misfires on any UK person travelling or on a VPN. Say it plainly to everybody
instead.

**D5 — No hreflang.** With one English site and no alternate-language versions,
`hreflang` has nothing to point at. Adding a lone `hreflang="en-gb"` is a no-op
that looks like diligence. Recorded so nobody adds it later believing it helps.

**D6 — No multi-currency.** Prices are GBP and shown as £. That is honest for a
service that posts from the UK, and a converted display price we do not charge
would be the bait-and-switch `structured-data.ts` already refuses to commit.

## Phases

### S0 — Connect the instrument (ops, ~1 hour, no code)

Finish `docs/seo-plan.md` Phase 0: verify the Search Console property for the
canonical host, submit the sitemap, and screenshot the baseline.

**This is the decisive answer to "are those 40 US users people?"** Search Console
records impressions and clicks from real searches. Crawlers do not search, so
they do not appear in it at all. GA can be fooled by bot traffic and referral
spam; Search Console cannot be fooled in the same way. If there are US
impressions against real queries, there is a real audience. If GA shows 40 US
users and Search Console shows no US impressions, we have our answer and S6
should not be built.

Two supporting reads, both free and both today:

- **GA4** — engagement rate and average engagement time for the US segment, and
  whether those sessions land on a spread of pages or all on one. Near-zero
  engagement across one landing page is the signature of a bot.
- **Search Console → Performance → Countries**, filtered to the pages that are
  actually ranking. "Student Birthday Cards" is the number two page at 261 views
  and is the one to look at first.

Nothing ships to users. Everything after S5 depends on what it says.

### S1 — Turn the refusal into a signpost

The single highest-value change, and the smallest.

`address-modal.tsx:50` currently says the postcode looks wrong. It should say
what we deliver and what they can still do: that cards are posted to UK
addresses, and that the sender can be anywhere. Same for the `AddressFields`
lookup helper text, which says "Find address" against a UK-only provider
(postcodes.io / Ideal Postcodes) without saying so.

The API's DTO messages (`must be a valid UK postcode`, in four DTOs) surface to
API consumers rather than to the person, and are accurate. They are out of scope
here; changing them is a wire-contract change for no gain.

**Test:** the refusal names the delivery scope, and does not tell the person
they mistyped.

### S2 — `areaServed` in the structured data

Add `areaServed: { "@type": "Country", name: "United Kingdom" }` to the
Organization node, and to the `Offer` nodes where a delivery area is what the
offer is bounded by. Machine-readable, exact, and consistent with what checkout
enforces — which is the file's existing rule.

**Test:** the audit already run against `structured-data.ts` extends to the new
claim; nothing asserts a territory the send path does not enforce.

### S3 — One definition of postable, and a count of who it turns away

Add the country to `MISSING_ADDRESS_WHERE` so the dashboard count, the contacts
filter, the smart-list rule and the CRM readiness panel all agree with what the
send path will actually do.

Care needed, and this is why it is its own phase rather than a line in S1:

- `addressCountry` is `String? @default("GB")`, so **null must count as GB** —
  every manually-added and CSV-imported contact predates any country being set,
  and treating null as non-UK would empty every customer's contact list
  overnight.
- The change moves numbers that customers have seen before. A UK-only account
  should see no change at all; that is the test that matters.
- The contacts list needs a way to _see_ the newly-excluded ones, or the count
  drops with no explanation. The `missingAddress` filter is the natural home.

**Test:** an account whose contacts are all GB or null sees identical counts
before and after. A contact with a complete US address is excluded from
readiness, and the send-time refusal and the readiness panel agree.

**And while we are here, count the refusals.** S1 changes what the postcode
refusal says; this adds a consent-gated GA event recording that one happened and
nothing else — no postcode, no address, no email. Somebody who reached the
address field and could not finish is a person who tried to buy from us and was
turned away, which is a far better demand signal than a session count: it cannot
be a crawler, because a crawler never gets that far.

It is the instrument that tells us **which** country to build S7's second page
for, instead of reading it off a GA tail. Consent-gated means it undercounts;
that is the honest trade and it is recorded here so nobody later reports the
number as complete.

### S4 — Say it where they arrive

Hero copy, meta description and OpenGraph description. One clause, not a banner:
posted to UK addresses.

Deliberately after S1–S3, because until those are true, saying it on the
homepage advertises a promise the app then breaks in three places.

The `docs/seo-plan.md` "Rules for a new public page" checklist applies unchanged;
this adds no pages.

### S5 — A destination for the question

An FAQ entry — "Can I send a card from outside the UK?" — answering the thing a
US visitor actually wants to know: yes, you can be anywhere, the card is posted
to a UK address, prices are in pounds. The FAQ is already marked up as
`FAQPage` (seo-plan Phase 5), so this is also the answer Google can surface
directly.

### S6 — One country page, built so it is not a doorway page

Only if S0 shows a real audience.

`docs/seo-plan.md` already rules out **"keyword-stuffed doorway pages per town or
per school name — the obvious next idea after Phase 5, and the one that gets a
site penalised."** A country page is the same idea wearing a different hat, and
the difference between the legitimate version and the penalised version is not a
matter of degree. `lib/audiences.ts` already writes the test down, in the rule
the `/for/` pages are held to:

> A doorway page is the homepage with one noun swapped, and search engines are
> explicitly looking for exactly that. … If two audiences would genuinely say the
> same thing, they don't both need a page.

So the page earns its place only if it answers questions a UK visitor never asks.
For the United States, it does, and all of these are true and currently unsaid:

- **Can I even use this?** Yes — your card, your billing address, any country.
  Verified: no `allowed_countries` on checkout, no country at sign-up.
- **Where does the card go?** A UK address. We do not post to US addresses, and
  the page says so plainly rather than burying it.
- **What will I be charged?** Pounds. Your bank converts; we quote one currency
  and charge it (D6).
- **When does it arrive?** UK working days, UK bank holidays, and a same-day
  cut-off in UK time — which is the middle of the American night, and is the
  single most useful thing the page can tell somebody in California.
- **Who is it for?** A US company with UK staff or clients; somebody with family
  in the UK. That is a different job from the homepage's.

None of that survives a find-and-replace into another country, which is the test.

**URL shape: `/from/united-states`,** not `/us` and not `/united-states`. The
preposition is the proposition — it says _sending from_, and it cannot be
misread as "Kudos delivers in the US", which is exactly the misreading a bare
country slug invites. It also sits cleanly beside the existing `/for/[audience]`
pages: one is who you are, the other is where you are.

Built to the "Rules for a new public page" checklist in `docs/seo-plan.md` —
`isPublicPath`, `sitemap.ts`, one `<h1>`, `alternates.canonical`,
`openGraphFor`, a meta description, alt text, constants not hand-typed numbers,
and then loaded logged out and read as HTML. Every one of those has been got
wrong in this repo at least once.

**The homepage does not change.** It stays the UK page and the core of the
platform, exactly as it is.

### S7 — The rule for the second country page

Written now, while nobody wants one, because the pressure to stamp out six more
arrives the moment the first works.

A second country page is justified when **both** are true:

1. **Evidence, from S0's instrument** — Search Console impressions against real
   queries from that country, or non-UK postcode refusals from it in S3's
   counter, at a volume that is not noise.
2. **Something genuinely different to say** — at least two of S6's five questions
   answered differently than on the US page. Currency and timezone differ for
   every country and are not enough on their own; "same page, different flag" is
   the doorway pattern.

Last week's tail — India 4, Afghanistan 2, Singapore 2, UAE 1, Armenia 1 — meets
neither. Generating seven country pages from that data is precisely the thing
`docs/seo-plan.md` warns about, and it would put the pages that currently work at
risk to serve nine sessions.

## Explicitly not doing

- **Shipping outside the UK.** Not a messaging change; a fulfilment, postage-
  pricing and lead-time change. Out of scope and not proposed.
- **A country selector on the address form.** It would imply we post there.
- **Localised or translated pages.** See D5.
- **Anything conditional on the visitor's location.** See D4.
- **A country page per country in the analytics tail.** See S7.
- **hreflang, still.** S6's pages are not translations of one page; they are
  different pages answering different questions, all in en-GB. `hreflang`
  describes the former and would be wrong for the latter. `docs/seo-plan.md`
  ruled it out for a different reason that still holds.

## Open questions

1. **Do we want the US market deliberately?** S6 assumes yes, conditional on S0.
   A US company sending to UK staff is a real proposition and a different one
   from the homepage's — but serving it well may eventually mean things this plan
   does not cover, such as a US-hours support expectation. Worth deciding rather
   than drifting into.
2. **Which canonical host is Search Console verified against?** `seo-plan.md`
   Phase 0 recommends the apex, `https://kudos-cards.co.uk`, since `netlify.toml`
   and `WEB_APP_URL` already use it. Verifying the wrong one measures a site
   nobody visits. Settle it before submitting the sitemap, not after.
