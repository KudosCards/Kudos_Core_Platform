# ADR 0164 — Authoring the marketing content layer

Status: accepted
Date: 2026-08-18

## Context

SEO Phase 5 (docs/seo-plan.md) is the content layer: an FAQ, audience pages behind the
homepage's "Used by" pills, and occasion guides. It's the phase that earns non-brand traffic,
and it's open-ended — pages keep being added long after the phase "ends".

The plan left one decision to make first: **how this content is authored**. It offered MDX
in-repo as the cheap default and a CMS only if non-engineers will write. Neither was chosen
before now because the answer depends on what the content actually is, and that only became
clear once the pages were specified.

Two facts settled it.

**The content is not prose.** An FAQ is a list of question/answer pairs. An audience page is
a headline, a set of pains, a proof point and a CTA. These are _structures_ with a repeated
shape, rendered by one template, not documents whose author chooses their own headings. MDX
is good at the second thing and adds nothing to the first — it would let every page invent
its own layout, which is how a content section stops looking like one site.

**The repo already does this.** `lib/legal/terms.ts` and `lib/legal/privacy.ts` are typed
content modules — a `LegalDoc` of typed blocks — rendered by one `LegalDocument` component.
That pattern has held for a document far longer and far more legally sensitive than any
marketing page, without an MDX toolchain.

There's also a correctness reason specific to this product. Phase 3 found two customer-facing
price claims that contradicted what checkout charges. Marketing copy that quotes a number is
a copy of that number, and copies go stale silently. In a TypeScript module the number is
interpolated from `CARD_PRICE_MINOR`, `POSTAGE_MINOR` or `PLAN_CATALOG` and a product change
rewrites the sentence. In MDX, or in a CMS, it is typed by hand into a body of text that
nothing checks.

## Decision

**Marketing content is authored as typed TypeScript modules under `apps/web/src/lib/`, rendered
by a route template.** No MDX, no CMS, for now.

Specifically:

- One module per content type, exporting a typed structure (`FAQ_SECTIONS`, and the equivalent
  for audience pages when they land). The type is the schema — a missing field is a build
  error, not a gap discovered in production.
- **Any number in the copy is interpolated from a constant**, never typed as a literal. Prices
  from `pricing.ts`, plan caps and features from `PLAN_CATALOG`, card size from
  `card-format.ts`, dispatch lead from `dispatch.ts`.
- **Structured data is generated from the same module the page renders.** The FAQPage markup
  is built from the same `FAQ_ENTRIES` strings the page prints, so the marked-up answer and
  the visible answer cannot diverge — a divergence search engines treat as cloaking, and
  which a hand-maintained second copy produces sooner or later.
- The no-invention guardrail from the homepage still applies: no statistics, testimonials or
  claims that aren't traceable to a constant, an ADR or the published company record.

## Consequences

Content changes go through code review and ship with a deploy. That's a real cost and it's
the point: this copy makes price and delivery commitments, and the two wrong price claims
Phase 3 caught were both in hand-written strings.

Non-engineers cannot edit copy without a developer. Accepted for now — nobody outside
engineering currently writes this content. **Revisit if that changes**: the migration path is
a CMS behind the same typed interface, since the route templates consume a structure and don't
care where it was loaded from. Keeping the numbers derived from constants would then need a
different mechanism, which is a real cost of that move and should be weighed at the time.

Long-form editorial — an occasion guide that's genuinely an article rather than a structure —
is the one case this doesn't serve well. If those materialise as real prose rather than as
another repeated shape, MDX for that route only is the smaller change, and this decision does
not preclude it.
