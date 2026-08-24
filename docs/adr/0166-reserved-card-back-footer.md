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
