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
  ready / needs-address / invalid-postcode / unresolved-token / duplicate buckets
  (each a total `count` plus a bounded `sample` for drill-in) and the exact,
  VAT-decomposed price for the whole selection — read-only, creating nothing.
  Buckets **overlap by design**: one recipient can carry several problems at once
  (e.g. no address _and_ an unresolved `{teacher}`), and each is reported so a fix
  never surprises the buyer with the next issue. `ready` is the count with _no_
  problem — so the buckets don't sum to `total - ready`; the web frames it as
  "N cards need attention" with a per-issue breakdown that may repeat a card.
  The `price` covers only the **mailable** cards (those with a valid address),
  because `bulkSend` gives no order line to the rest — so the figure shown equals
  the eventual Stripe charge, never overstated by contacts still missing an address.
  Unresolved tokens are found with the shared `unresolvedMergeTokens` util
  (built on the merge engine); duplicates are recipients who ordered the same
  design in the last 30 days. The web surfaces this as a checks banner with
  inline fixes (P2 web slice). This also corrects the composer's rough estimate,
  which used the wrong card price.
- **P3 — Confirm & proof.** The Review & confirm gate with the checks summary,
  exact total, and a downloadable proof/contact sheet; the same per-card + address
  record kept on the order detail as a post-payment receipt.
- **P4 — Scale & guard rails.** Performance pass and duplicate-window tuning
  shipped; server-rendered thumbnails deferred. The bulk-send **N+1 was removed**:
  `bulkSend` created one occasion per contact in a serial loop (10,000 round-trips
  for a 10,000-card run) — it now builds all occasions with client-generated ids
  and inserts them in a single `createMany`. The **duplicate check was tightened**:
  it only counts orders that actually reached payment (`paid`/`fulfilling`/
  `completed`), so an abandoned unpaid draft no longer false-flags a recipient as
  "recently sent" (a cancelled order already deletes its lines). Server-rendered
  thumbnails stay **deferred**: the virtualized live render mounts only a few
  dozen canvases at a time regardless of run size, so there's no measured heaviness
  to justify a server rendering pipeline yet — the ADR's original "later, only if"
  bar hasn't been met.

P1a shipped items 1–2 of the review: the `face` prop and the flip lightbox,
wired into the `/send` composer (each preview tile opens the whole card + its
address). P1b adds the full **"Review every card"** overlay — a searchable grid
of a card for _every_ recipient in the run, each showing the name + address it
posts to and opening the flip lightbox on click, virtualized (`LazyCardTile`
mounts a face's Konva canvas only while near the viewport) so a run of thousands
stays responsive. "Review all N cards" is promoted to a primary action at/above
the `REVIEW_ALL_THRESHOLD` (50) scale-adaptive cutover.

P3a adds the scale-adaptive **Review & confirm** gate. A small run keeps the
one-tap "Pay & send"; a run at/above `REVIEW_ALL_THRESHOLD` (50) changes the
primary CTA to "Review & confirm", which opens the full-screen review overlay in
a confirm mode — the same virtualized every-card grid, now with a sticky pay
footer carrying the pre-send-check summary, the exact total, and a Pay button
gated behind an explicit "I've reviewed the N cards and the addresses" tick. So a
five-figure run can only be charged after a deliberate look, never a stray click.

P3b adds the downloadable **proof / contact sheet**: a self-contained, print-ready
HTML document (Print → Save as PDF) listing every card in the run — the recipient,
the exact address it posts to, and the personalised message with its merge tokens
resolved per person — so the buyer keeps an offline record they can check, file or
share before paying. It's generated client-side (no server round-trip), all
contact data HTML-escaped, and offered from the order-summary column and the
review overlay (both the plain look-through and the confirm gate).

P3c completes P3 with the **post-payment per-card record** on the order detail.
The buyer's order detail already carries the shipping-address _snapshot_ per line
(the exact address posted to, frozen at order time), so it now shows the full
posting address per card and offers a **"Download proof sheet"** — an order-receipt
variant of the same printable document, listing every card with its recipient,
snapshot address, postage, price, fulfilment stage and Royal Mail tracking. The
sheet chrome is shared with the pre-send proof so both read as one document.

P2 shipped the server preflight endpoint plus its web surface: the `/send`
composer runs the check automatically (debounced, sequence-guarded) whenever the
design, postage or selection — including an inline address fix — changes, and
renders a **Pre-send check** panel: "R ready · N need attention", each non-empty
bucket drilled into with the affected contacts (address problems get an inline
"Fix address" that opens the same editor), and the order summary switches from a
rough estimate to the exact, VAT-decomposed `PricingBreakdown` the server
returns. The old composer estimate used the wrong card price (£1.50); it now
sources `CARD_PRICE_MINOR`/`POSTAGE_MINOR` from shared-types so even the
pre-check estimate can't drift.

## Consequences

- Buyers can review the personalised inside message, not just the cover, before
  paying — closing the biggest reassurance gap.
- The flip viewer + `facesOf`/`insideFacesHint` helpers are reusable across the
  send flows, the designs gallery and (later) the ops print-run.
- Resolved finding: the ops **print-run** overlay rendered only the front face
  per card (`CardFacePreview` with no `face` prop), so the personalised inside
  message never reached physical production. It now prints **every face a design
  has** — front, the inside spread, and back — one face per page (reusing
  `facesOf` + the `face` prop from P1), with a screen-only collation caption
  naming the recipient and face.

## Alternatives considered

- **Lift the cap by rendering all previews live.** Rejected: thousands of Konva
  stages would be far too heavy — hence virtualization now, thumbnails later.
- **Client-only checks.** Rejected: duplicate detection and exact pricing must be
  server-authoritative; a preflight endpoint also keeps the check and the eventual
  charge consistent.
