# 0166 — The bottom 30 mm of the card back is ours

## Status

Accepted — implemented.

## Context

We print on card stock whose **back is already printed** with the Kudos logo and
a QR code in a strip along the bottom edge. That is a physical property of the
stock; it exists before any design reaches the press.

Nothing in the software knew this. `back` was simply a fourth editable face,
identical in every respect to `front`, `inside-left` and `inside-right`:

- `buildCardDocument()` and the designs list both create a `back` page.
- `PAGE_NAMES` in the design editor offers it as an ordinary tab.
- `facesOf()` — in both the server PDF service and the web print overlay —
  returns every face a document has, `back` included, and sends it to print.

So whatever a customer put on the back was printed **over branding that is
physically already on the card**. In August 2026 a client filled the back of a
76-card order with a grid of partner adverts, covering the logo and QR entirely.
The order was caught before dispatch, but only by eye.

Two facts made this worse than a cosmetic problem:

1. The QR on the pre-printed strip is how a recipient reaches their digital
   message page. Covering it removes the product's digital half.
2. Nothing in the pipeline would ever have flagged it. The editor had no notion
   of the strip, the previews had no notion of it, and the print engine had no
   notion of it, so a design could pass every check we had and still be wrong.

## Decision

Reserve **the bottom 30 mm of the back face**, measured up from the trim edge, as
house space. Customers keep the whole of the rest of the back, and all of the
other three faces.

The rule lives once, in `@kudos/shared-types` `card-format.ts`:

- `BACK_RESERVED_FOOTER_MM = 30` — the physical measurement.
- `backReservedFooterUnits(size)` — that measurement in design units, **derived
  per size** rather than hardcoded. The authoring canvas is one fixed 450 × 634
  space *fitted* onto whatever card is printed, so a fixed unit count is a fixed
  *fraction* of the card: 128.5 units is 30 mm on A6 but 42.5 mm on A5.
- `backReservedFooterTop(size)` — the y coordinate content must stay above.
- `isInBackReservedFooter(box, size)` — the overlap predicate.

Every surface derives from those, so they cannot disagree with each other:

- **Print engine** (`apps/api/src/print-pdf/render.ts`) clips the back face to
  the band. Applied at *page* level, before the white base and the background,
  because a background bleeds to the page edge — clipping only the design space
  would let a full-bleed image on the back print straight over the logo.
- **Browser print overlay and every read-only preview** share
  `CardFacePreview`, which applies the same clip to the back. The white base
  stays outside the clip so the strip previews as paper, not as a hole.
- **Design editor** shades the band over the artwork, draws a dashed rule at its
  top, offers that rule as a drag snap target, and warns when anything on the
  face reaches into it.

Enforcement is in the print engine, not only in the editor. The editor is a
convenience; the printer is the guarantee. Every design saved before this ADR
existed — including the advert-filled one that prompted it — is covered without
being edited.

## Alternatives considered

**Reject the design at print time.** Loud, but it turns one stray element into a
blocked order, and it does nothing for the designs already saved. Clipping costs
the offending element its bottom edge and nothing else.

**Remove the `back` face from the editor entirely.** Cleanest rule, but it takes
away a face customers do legitimately use — a short message, a company mark
above the strip. The strip is 30 mm of a 148 mm card; the other 118 mm is
perfectly good design space.

**Rewrite existing saved designs to move content out of the band.** Rejected:
silently mutating a customer's saved artwork is worse than showing them, in the
editor, what will actually happen. The band renders over their content with a
warning; they choose what to do about it.

**Measure the 30 mm from the printer safe area instead of the trim.** It leaves a
thin strip below the band where content would still print into the branding.
Measuring from the trim can only ever over-reserve. On A6 the two are the same
edge; on A5 the design is centred in the trim, so the band lands ~0.75 mm high —
in the safe direction.

## Amendment — reviewing what the band hides

Clipping the band in every preview made a full-bleed back impossible to review:
the part being hidden is exactly the part an operator needs to look at, so
"is the customer's artwork being cut, and by how much?" had no answer anywhere
in the product. The first real case was the advert-grid back this ADR was
written for — its bottom row simply vanished from the print preview.

`CardFacePreview` therefore takes `reservedFooter: "clip" | "reveal"`.
`clip` stays the default everywhere, because a preview should show what prints.
`reveal` draws the artwork in full and marks the band instead — a light tint and
a dashed rule on the line. The print-run overlay offers it as an **As printed /
Full artwork** toggle, and disables browser print while it is on: that path
rasterises what is on screen, so a revealed band must never reach paper. The
server-side PDF is unaffected by the toggle, which is the point of enforcing
this in the print engine rather than the UI.

Seeing the band is not always enough. When artwork genuinely doesn't fit, the
question becomes "what did the customer actually send us?" — and every rendered
answer is wrong: a card face is a fixed 450x634 canvas with the background
cover-cropped into it, so a render has already lost whatever fell outside the
crop as well as whatever falls in the footer. The print-run overlay therefore
offers **Download original artwork** on a back face: the stored upload, streamed
untouched, so it can be repurposed (dropped on an inside page, say) or sent back
to the customer to fix.

That download fetches a URL server-side, and design documents carry
customer-supplied URLs, so it is guarded twice: the URL must appear in that
card's own stored design, and its host must be in the same allowlist the print
engine uses. Either guard alone would let something through that the other
catches, so both are tested against a URL the other would accept.

The editor's band was softened from near-opaque to half-opaque for the same
reason. Hiding a customer's artwork tells them "gone" when what they need to
know is "gone, and here is what" — the label on the band and the panel warning
carry that message in words; the artwork underneath should stay legible enough
to move.

## Amendment — telling the customer, not just enforcing it

The print engine guarantees the strip. That is not the same as a customer
understanding it, and an audit of what they are actually *told* found the
guidance thinner than the enforcement:

- **The editor's overlap warning never fired for a page background.** It read
  `layer.find(".element")`, and a background is not an element — so the single
  most common way to fill a back, and the exact shape of the order that prompted
  this ADR, produced no warning at all. A defect, not a decision.
- **The customer's own preview clipped in silence.** In the flip viewer the back
  showed a blank strip with no explanation, which reads as a rendering fault.
- **Nothing appeared at the point of sale.** The pre-send check flagged
  addresses, unresolved tokens and duplicates, and said nothing about artwork
  about to be cut.
- **Nothing appeared before the customer started.** The rule was only ever
  stated after something had already been placed in the strip.

All four now say it:

| Surface | What it says |
| --- | --- |
| Editor, back tab | A standing neutral note, before anything is placed |
| Editor, when affected | Amber — worded differently for a background (nothing to move) than for a stray element |
| Customer's card preview | A line under the back face explaining the blank strip |
| Pre-send check | A design-level warning, the last gate before payment |

The pre-send warning is design-level rather than a per-recipient bucket: the
artwork is identical on every card in the run, so a bucket would list all 76
recipients for one problem. It is also not a reason a card "needs attention" —
it sends perfectly well, it just prints without that strip — so it shows even
when every card is otherwise ready.

`backArtworkInReservedFooter` reads the stored document, and is deliberately
approximate for text: real text height depends on wrapping and on which font has
loaded, which only a renderer knows. It counts a single line at the standard
line-height, so a wrapped block running into the strip is not counted there. The
editor measures rendered nodes and does catch it, and the print engine clips
regardless. Erring toward under-reporting keeps the pre-send check from crying
wolf on designs that are fine.

## Consequences

- 30 mm is a single constant. If the stock changes, one number moves and the
  editor, both previews and the print engine follow.
- The rule is stated in millimetres of real card, so it survives a change of
  trim size. Launching A5 needs no further work here.
- A back that already has content in the band will render with it hidden and a
  warning shown, rather than looking as it did yesterday. That is the intended
  behaviour, but it is a visible change to existing designs.
- The editor guides against the A6 band because ops picks the trim per print run
  and the editor cannot know it. A6's band is the taller of the two in design
  units, so guiding against it is safe for a design later printed at A5.
