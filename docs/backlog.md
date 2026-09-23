# Backlog

Work that is known, understood well enough to start, and deliberately not being
done yet. Each entry says what would unblock it, so nothing here needs
rediscovering.

Not a wish list. Something belongs here once somebody has looked at it properly
and decided _not now_; ideas nobody has examined belong in a plan doc first.

**Phased plans live in their own documents** and are not duplicated here:
`docs/card-print-quality-plan.md`, `docs/cleancloud-integration-plan.md`,
`docs/leadconnector-private-token-plan.md`, `docs/performance-backlog.md`.

---

## Billing

### A Supabase outage reads as "nothing owed" — wallet campaigns

**What happens.** `WalletCampaignsService.confirmedEmailFor` returns `null` both
when Supabase says the address is unconfirmed and when Supabase fails to answer
at all. The caller cannot tell those apart, so an outage is tallied as `skipped`
— "nothing is owed here" — rather than `failed`, and the sweep's warning never
fires for a customer who is owed a credit.

**What would unblock it.** Distinguish the two at the point the error is caught:
return a failure the caller can count, and let the sweep warn on it. Small, and
worth doing with a test that stubs the admin client into an error.

**Why not now.** Found by a review of click and forget, in a file that feature
never touched (ADR 0265). It is a billing change and belongs to its own commit,
not to a review of somebody else's.

---

## Integrations

### Is `GET /contacts` deprecated? — LeadConnector

**The question.** Search results state that the endpoint our LeadConnector client
pages through has been deprecated in favour of `POST /contacts/search`, which
pages on a `searchAfter` cursor rather than `meta.nextPageUrl`.

**Why it matters.** If true, this is a countdown on the whole LeadConnector
integration — both the OAuth lane and the token lane, since they share one
client. It is currently working in production, so there is no urgency, only a
deadline nobody has read.

**Evidence: reported, not confirmed.** One clear statement, uncorroborated, and
reported page sizes differ between sources (20 in one, 100 in another) — which is
itself a reason to read the page before writing a loop against it. Every
HighLevel documentation host (`marketplace.gohighlevel.com`,
`help.gohighlevel.com`, `highlevel.stoplight.io`) is blocked by the development
environment's egress proxy, including through WebFetch, so this cannot be settled
from a session. Search results reach those pages; we cannot.

**What unblocks it.** One person opening
`marketplace.gohighlevel.com/docs/ghl/contacts/get-contacts/` in a browser and
saying whether it carries a deprecation notice, and if so what
`POST /contacts/search` takes and returns.

**Then the work is focused**: the same paging loop with a POST body instead of
query parameters, and `searchAfter` instead of `nextPageUrl`. See ADR 0253.

### Pace LeadConnector against its published rate limit

**The gap.** HighLevel publishes 100 requests per 10 seconds and 200,000 per day,
per app per location, and returns `X-RateLimit-Remaining` and `X-RateLimit-Max`
on every response. We read neither. `GOHIGHLEVEL_MAX_PAGES = 100` at 100 contacts
a page means a large sub-account can fire up to 100 requests as fast as the
network allows, straight through the burst limit.

**Why it is not urgent.** It works: `httpRequest` honours `Retry-After` on a 429,
so a sync that trips the limit recovers rather than failing. But that is the
retry doing pacing's job, and the budget it burns is shared with whatever else
the customer has connected to that sub-account.

**Evidence: confirmed** (the limits and the headers are consistent across
several sources).

**Worth pairing with the item above** — both touch the same loop, and doing them
together is one review rather than two.

### CleanCloud: occasions from lapsed customers (N6)

`getOrders` would let a dry cleaner send to customers they have not seen in six
months, which is a different and possibly better occasion than a birthday for
this kind of business. Deliberately out of scope until the nightly contact sync
has run against a real account and the address-parse quality is known. See
`docs/cleancloud-integration-plan.md`.

---

## Print and artwork

### Distortion as a pre-send finding (P7, item 3)

**Blocked on data, not on code.** It needs each image's natural size server-side.
The only cheap source is `DesignAsset.width/height`, which is trustworthy for
uploads made since that measurement moved server-side — but the legacy designs
this check exists to catch reference legacy assets, whose stored dimensions are
the browser's or null.

So it needs either a backfill of `DesignAsset` dimensions (ops work against
production) or a per-image fetch inside a preflight that runs on every send
review, which is a network round trip per image on a path a customer waits on.

**Shipping it before a backfill would leave it silent on exactly the designs it
targets**, which is worse than not having it.

Note also that stretching is a _supported_ choice — the editor's
`lockImageAspect` is on by default and turned off deliberately — so this can only
ever be a warning with a known false-positive class. See
`docs/card-print-quality-plan.md`, P7.

### Retire the browser print path outright (P8)

Already gated: browser print is refused whenever the profile says
`folded-sheet`, so nothing can print the wrong shape today. Removing it
altogether is cheaper now than it was, and is not the same job as making the
content preview show imposed sheets — which is a separate piece of work nobody
has asked for. See `docs/card-print-quality-plan.md`, P8.

---

## Product

### "Click and forget" — standing approval for a list of contacts

Business customers keep saying a version of the same thing: they love the idea
and do not have time to keep on top of it, and would like to add contacts once
and trust us to fulfil. That is close to what the platform already does, and
the useful part of the scoping was finding the five places it stops and waits
for a human.

The first of them is done and was worth doing whatever happens to the rest: a
card that did **not** go out told the customer nothing. `AutoSendService`
notified only on success and audited every failure to a log nobody reads —
survivable while customers are still watching, fatal the moment we tell them
they need not. C1 (ADR 0254) closed it.

Scoped in `docs/click-and-forget-plan.md` and built, C1 to C8 (ADRs 0254 to
0261): card pool plus message pool, birthdays only, auto top-up from a stored
card, Pro and above with the Free tier seeing it locked. "Approve once, ever"
is now true for an account that sets one up, there is a page to set it up on,
and the homepage says so.

The page it is set up on is getting a second pass — see
`docs/click-and-forget-improvements-plan.md`, which also records two faults
found while reading it: the design pool accepts cards that are not birthday
cards, and the page never says how many contacts the instruction actually
covers.

Two things are deliberately not built and are not waiting on a decision so much
as on a purchase and a pass over the catalog:

- **AI-drafted messages.** `source: "assisted"` is recorded on a message and
  nothing writes it. A vendor and a data-processing agreement come first, and
  the hand-written pool demonstrably works without it.
- **The catalog description pass** below, which is what turns varying a card
  into matching one.

Two things surfaced by the scoping belong here rather than there, because they
are ops work and they gate the build:

- **The catalog cannot describe itself.** `CardDesign` carries a category, a
  name, a slug, a SKU and a thumbnail, and nothing that says who a design
  suits. Picking a card from a pool "to fit the recipient" has nothing to read.
  Describing the 217 designs is the same pass over the catalog as the A4
  re-export, so it should ride along with it.
- **Recipients carry no attribute to match against** beyond name, birthday and
  the subscriber's own tags — and age is unknowable wherever `birthYearKnown`
  is false, which is every CleanCloud contact by design (ADR 0252). Tags are
  the only honest signal we have today.

### `engine-resilience` times out when the suites run together

`decodeImage orientation › turns an oversized photo's pixels upright` re-encodes
a large image with sharp and carries Jest's default 5-second timeout. Running
the API and web unit suites concurrently, it has now timed out twice on
different changes, neither of which touched `print-pdf`. In isolation it takes
2.3 seconds, and it has not failed on CI.

So it is a real intermittent test rather than a broken one, and the fix is to
give that test an explicit timeout that matches what it actually does — not to
skip it, and not to keep re-running until it passes. Worth doing before it
costs somebody an afternoon believing their change broke the print engine.

## Scope and messaging

### Say what we actually serve, to visitors who are not in the UK

A third of last week's active users were outside the UK, and the site does not
say we post to UK addresses until it refuses a postcode — by which point the
visitor has signed up and chosen a card. Separately, and more seriously, the one
shared definition of a mailable address does not check the country, so a contact
with a complete overseas address counts as ready everywhere and is refused at
send.

Planned in `docs/uk-scope-messaging-plan.md` (S0–S7). S3, the postable
definition, is a correctness fix worth doing whether or not the traffic turns
out to be people. S0 is the prerequisite for the rest and is an hour of ops with
no code: Search Console was never verified, so six shipped phases of SEO work
are currently unmeasured.

## Catalog data quality

Both surfaced by the catalog sync itself, neither blocking, both worth doing
while the catalog is open for the re-export (`docs/ops/catalog-re-export.md`).

### Two cards, one address

`/thank-you-red` and `/well-done-flowers` each have a second card claiming the
same URL, which keeps a `-2` on the end of its address for ever, even if
renamed. A card's URL is assigned once and never recalculated, because changing
it would break indexed links and the QR codes on cards already posted. Worth
fixing before those cards are published.

### 93 cards with no landing page

seasonal (54), inspirational (22), fitness themed (10) and good luck (7) sit
under `/cards/other`, which is deliberately not indexed. They sync, they browse,
and their own pages are indexable — there is simply no category page for anyone
to find them through. Either name the categories properly or correct the value
upstream.
