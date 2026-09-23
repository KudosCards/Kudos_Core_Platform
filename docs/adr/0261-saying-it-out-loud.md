# 0261 — Saying it out loud

## Status

Accepted

## Context

Phase C8 of `docs/click-and-forget-plan.md`: telling people the thing exists.

Everything under it is built and merged — the skip notices (ADR 0254), the
wallet watch and auto top-up (0255), the standing order and its consent (0256),
automatic approval (0257), the page that switches it on (0258), the catalog
attributes (0259) and the message placement (0260). None of it is on the public
site, so nobody outside the app knows it is there.

I twice advised holding this phase until a real standing order had posted a real
card, on the grounds that marketing a promise is a different risk from shipping
a feature. That advice was heard and overruled, which is the owner's call. So
the question this ADR answers is not _whether_ to say it, but **what can be said
without it becoming a claim we cannot back**.

## Decision

### The same two rules the FAQ already had

`apps/web/src/lib/faq.ts` was written under a house rule that turned out to be
exactly the one this phase needs:

> 1. Every number comes from a constant.
> 2. Every answer is something the product actually does.

The homepage section is written under both, and the second is the load-bearing
one here. Everything the section claims maps to something merged: contacts and
CRM sync, a pool of designs and messages, variation between years, and a notice
when a card does not go.

### Copy is content, not markup

The section's prose lives in `apps/web/src/lib/click-and-forget.ts`, beside
`faq.ts` and `audiences.ts`, rather than inline in `page.tsx`. Prose sitting in
JSX is prose nothing can check, and on this feature the claims are the part that
can go wrong. The markup stayed on the page; only the sentences moved.

That makes `click-and-forget.test.ts` possible, and it guards four things that
would be expensive to get wrong:

- **The plan named is the plan that carries auto-send**, and is the _cheapest_
  one that does — "on Pro and above" is only true if nothing below Pro has it.
  The catalog is in upgrade order, so the first match is the floor.
- **The homepage and the FAQ name the same plan.** Two pages answering one
  question with different plan names is how somebody pays for the wrong one.
- **The honesty line survives.** "You choose the cards and write the messages"
  is the answer to the obvious fear about handing sending over, and it is said
  twice on purpose.
- **The two things we do not do stay unsaid** (below).

Each of those was confirmed by breaking the copy and watching the test fail.

### Two things the copy deliberately does not say

1. **That we choose a card to suit each person.** The age bands and tones exist
   (ADR 0259) and the pick prefers a matching band (0260), but the 217 designs
   have not been described yet — `docs/ops/catalog-describe-designs.md` is a
   runbook nobody has run. Until they are, a card is **varied**, not matched.
   Saying otherwise sells an ops pass we have not done.
2. **That messages are written for you.** `source: "assisted"` is recorded and
   nothing writes it. Drafting with a model is a vendor and a data-processing
   agreement, not a copy change.

Both are guarded by the test rather than by a comment, because a comment does
not survive somebody else's enthusiasm.

### What the FAQ gained

Two entries under "Sending", beside the existing auto-send answer, which now
understated what exists:

- _"Can I set it up once and stop thinking about it?"_ — what it is, what it
  costs (wallet balance at the plan's usual card and postage price), that the
  cards and words are yours, that it varies, and that it can be switched off
  without affecting cards already on their way.
- _"If you're sending on my behalf, how do I know it worked?"_ — the C1 answer.
  A card that does not go is reported, in the app and by email, with what to do
  about it. This is the question the feature has to answer to be trusted at all,
  and it is the one thing we can claim with no hedging, because it is the part
  that was built first.

Both are plain prose, because the FAQPage JSON-LD is generated from these exact
strings — the visible text and the marked-up text are the same text by
construction.

### No testimonials, no numbers

Nothing in this phase quotes a customer, a count of cards sent, or a time saved.
There is nothing to quote yet. The one piece of social proof in the copy is
"the thing people tell us", which is a paraphrase of a sales conversation and
claims nothing measurable.

## Consequences

- The homepage carries a `#click-and-forget` section; step 2 of the three-step
  block now points at it rather than half-describing it.
- `page.tsx` imports its own section's words from `lib/`, which is the pattern
  the rest of the marketing content already follows.
- The copy cannot outrun the build: describing the catalog or drafting messages
  will each need the guard test changed on purpose, which is the point.
- Click and forget is finished as scoped. What remains is not code — the catalog
  description pass, and a real standing order posting a real card.
