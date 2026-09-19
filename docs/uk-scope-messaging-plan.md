# Saying what we actually serve

Analytics for the week to 19 September: 71 active users in the United Kingdom,
**40 in the United States**, then India 4, Afghanistan 2, Singapore 2, UAE 1,
Armenia 1. A third of the audience is outside the UK, and the SEO work
(`docs/seo-plan.md`, Phases 1–6) is what put them there.

Whether that traffic is people or crawlers changes how much it is worth. It does
not change whether the work is right, because everything below is either true
today and unsaid, or wrong today and quietly waiting for the first international
customer.

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

### S3 — One definition of postable

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

## Explicitly not doing

- **Shipping outside the UK.** Not a messaging change; a fulfilment, postage-
  pricing and lead-time change. Out of scope and not proposed.
- **A country selector on the address form.** It would imply we post there.
- **Localised or translated pages.** See D5.
- **Anything conditional on the visitor's location.** See D4.

## Open questions

1. **Is the US traffic people or crawlers?** It does not change whether this work
   is right — S3 is a correctness fix regardless — but it changes how much S4 and
   S5 are worth, and whether the next step after them is content aimed at that
   audience. In GA: engagement time above zero, and whether those sessions land
   on a spread of pages or all on one. "Student Birthday Cards" is the number two
   page at 261 views and worth checking first.
2. **Do we want that market deliberately?** A US company sending to UK staff is a
   different proposition from a UK company, and if it is one we want, it earns
   its own page rather than a clause in the hero. That is a business decision,
   not a code one, and this plan does not assume the answer.
