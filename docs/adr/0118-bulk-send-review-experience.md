# 0118 — Bulk-send "review before you send" experience

## Status

Accepted (phased — this ADR covers the plan; slices land incrementally)

## Context

Customers commit real money — potentially five figures — to a single bulk send of
500 / 1,000 / 10,000 personalised cards. Before paying they need maximum
reassurance that every card will be **printed, personalised, and posted to the
correct recipient at the correct address**.

The `/send` composer (ADR 0027, 0106, 0107) is a strong base: pick contacts, fix
missing addresses inline, choose a saved design, see per-recipient previews, pay.
But reviewing the run before payment had real gaps:

1. **Only 8 previews** (`MAX_PREVIEWS`) then "…and N more" — no way to review the
   rest, search for a person, or spot-check a large run.
2. **Front face only.** A design has up to four faces (`front`, `inside-left`,
   `inside-right`, `back`), but the preview rendered only the front — so the
   personalised **inside message** (where `{name}` usually lives) was never seen
   before paying.
3. **No per-recipient personalisation check.** An unresolved `{token}` (a missing
   custom field / occasion) prints literally or blank; nothing flagged this across
   the actual selection.
4. **Card and address weren't verified together**, and there was no address-quality
   flagging, duplicate/already-sent guard, or exact price (only an estimate) before
   the Stripe redirect.

## Decision

A phased "review before you send" experience, with three design choices agreed
with the business:

- **Scale-adaptive review.** Small sends stay on the frictionless one-page
  composer; large sends (≥ 50 cards, a platform setting) route through a
  deliberate **Review & confirm** gate.
- **Hybrid rendering.** Review renders cards with the real Konva renderer,
  virtualized so only in-view cards mount. Server-rendered thumbnails are added
  later only if real large runs prove too heavy.
- **Authoritative pre-send checks.** A server preflight validates the whole
  selection (address quality, unresolved merge tokens, duplicate/already-sent) and
  returns the exact price breakdown.

### Phases

- **P1 — See every card, every face.** `CardFacePreview` gains a `face` prop; a
  reusable flip viewer + lightbox (`card-preview-lightbox.tsx`) shows all faces a
  design has, merged per recipient, with the recipient's name + address alongside.
  Then a searchable, virtualized "review all" grid replaces the 8-card cap, with
  scale-adaptive routing to the dedicated review step.
- **P2 — Server preflight check.** `POST /batch-orders/preflight` returns
  ready / needs-address / unresolved-token / duplicate buckets (with the exact
  people, paginated) and the exact price breakdown, surfaced as a checks banner
  with inline fixes.
- **P3 — Confirm & proof.** The Review & confirm gate with the checks summary,
  exact total, and a downloadable proof/contact sheet; the same per-card + address
  record kept on the order detail as a post-payment receipt.
- **P4 — Scale & guard rails.** Server-rendered thumbnails if needed; duplicate
  window tuning; performance pass.

This ADR's first slice (P1a) ships items 1–2 of the review: the `face` prop and
the flip lightbox, wired into the `/send` composer (each preview tile opens the
whole card + its address).

## Consequences

- Buyers can review the personalised inside message, not just the cover, before
  paying — closing the biggest reassurance gap.
- The flip viewer + `facesOf`/`insideFacesHint` helpers are reusable across the
  send flows, the designs gallery and (later) the ops print-run.
- Related finding to verify in a later slice: the ops **print-run** render uses the
  same front-only component, so the inside faces' path to physical production
  needs confirming.

## Alternatives considered

- **Lift the cap by rendering all previews live.** Rejected: thousands of Konva
  stages would be far too heavy — hence virtualization now, thumbnails later.
- **Client-only checks.** Rejected: duplicate detection and exact pricing must be
  server-authoritative; a preflight endpoint also keeps the check and the eventual
  charge consistent.
