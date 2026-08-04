# 0106 — Send to a segment

## Status

Accepted

## Context

ADR 0105 introduced **segments** (smart lists) — saved, live-resolving filters
over the contact book (occasion-mode like "birthdays this month", or contact-mode
like "missing an address") — but deliberately stopped at _resolving_ a segment to
a count + preview. It named sending _from_ a segment ("filter → bulk personalise
→ pay → send") as a separate later slice. This is that slice: it turns a resolved
segment into a paid, personalised bulk send — the payoff the segment concept was
built for.

The bulk-send composer (`/send`, ADR 0027) is already a mature money path: it
picks contacts, previews per-recipient personalisation, fixes missing addresses
inline, prices postage, and hands off to the same Stripe checkout every order
uses. The job here is to _seed_ that composer from a segment's people, not to
build a second sending path.

## Decision

Treat a segment as a **people-finder**: "Send to this list" resolves the segment
to its member recipients and seeds the existing bulk-send composer. The actual
send stays on the existing `bulkSend` money path — no new payment/order code.

1. **A member-resolution endpoint, capped for one order.**
   `GET /segments/members?segment=<preset-key-or-saved-id>` returns
   `{ name, members: Recipient[], total, capped }` (shared-types
   `segmentMembersSchema`). It looks up a `SEGMENT_PRESETS` entry by key **or** a
   saved `Segment` row by id (404 otherwise, and an empty key is rejected so
   Prisma's `id: undefined` can't return an arbitrary segment), then resolves the
   definition to its **distinct member recipients** via a recipient-centric query
   — each person appears once even when several of their occasions match. The set
   is capped at the plan's `batchOrderMaxSize` (the same limit `bulkSend`
   enforces); `total` is the true uncapped count and `capped` says the cap trimmed
   it.

2. **Members are returned regardless of postal address.** Occasion-mode segments
   naturally include people we can't yet post to; rather than silently dropping
   them, the composer receives them and surfaces the address gaps for inline
   fixing (or removal) — the behaviour bulk-send already has. This makes the
   "missing an address" preset a natural fix-then-send worklist.

3. **The predicate is shared, not duplicated.** The occasion-side match (type +
   date window) is factored into one `occasionMatch` helper used by both the
   preview count and the member query, and the recipient-side facets stay in the
   existing `recipientFilter`, so a segment's preview count and its resolved
   members can't drift apart.

4. **The web seeds the composer, nothing more.** `/segments` cards gain a primary
   "Send to this list →" action (hidden when the segment is empty) linking to
   `/send?segment=<key>`. `/send` resolves `?segment=` server-side and uses the
   members as the initial selection (de-duplicated against any `?recipients=`
   ids), passing a small `seededSegment` (name + total + capped) that drives a
   "Sending to **<name>** — N contacts" heading note and a plan-cap notice. Design
   pick, personalisation preview, postage, pricing, and pay are untouched.

## Consequences

- Sending from a segment reuses the entire audited bulk-send → Stripe path, so
  there is no second money path to keep correct, and the per-order plan cap is
  honoured identically.
- **Occasion double-send is possible and accepted for now.** For an occasion-mode
  segment (e.g. "birthdays this month"), the send goes out as a fresh
  `bespoke_campaign` order while the person's natural birthday occasion remains in
  approvals — so they could receive both unless it's skipped there. This matches
  how bulk-send already behaves. Consuming/reconciling the matched occasion is a
  coherent later refinement, left out here.
- No schema change or migration — purely additive on top of ADR 0105.

## Alternatives considered

- **Consume the matched occasions at send time** (mark them sent / skip
  approvals). Cleaner for occasion-mode, but it couples sending to occasion
  lifecycle and needs its own reconciliation rules; deferred so this slice can
  ship on the existing money path unchanged.
- **A bespoke campaign-send endpoint that takes a segment id directly.** Rejected:
  it would duplicate the composer's personalisation preview, address-fix, and
  pricing UX, and give the sender no chance to review/trim the list before paying.
