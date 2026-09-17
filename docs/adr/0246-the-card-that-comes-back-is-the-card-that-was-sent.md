# 0246 — Three ways a card stopped being the card that was chosen

## Status

Accepted

## Context

Phase 2 of docs/card-print-quality-plan.md. Three unrelated faults, grouped
because each is small, each is independent of the print pipeline, and each gets
harder to see once P4 rewrites the print path around it.

**A member's own artwork was squashed.** `designs-client.tsx` built the document
for "Upload your own artwork" with its own `CARD_WIDTH`/`CARD_HEIGHT` pair, and
the height said 600 against a canvas that has been 634 since ADR 0161. The
artwork was placed as an image _element_, and both renderers draw an element to
whatever box it is given — Konva's `<Image width height>`, pdfkit's
`doc.image(…, { width, height })` — so every upload was stretched into 3:4 and
left a 34-unit (7.9 mm on A6) white strip along the bottom of the front.

The catalog builder had exactly this bug and it was fixed years ago; its comment
still records the fix — _"a fixed-size image element … was pinned to the old
450×600 and left a blank strip once the canvas grew taller"_. The web path was
never touched. The number drifted because it was written down twice.

**The reserved-footer check could not see rotation.**
`backArtworkInReservedFooter` read `y`, `height`, `size` and `fontSize`, and
never `rotation`. Konva rotates about the element's origin, so a rotated box does
not span `y .. y + height`: at 270° it runs _upward_, at 90° it runs down by the
element's _width_. That function is wrapped by `reservedFooterViolation` and
turned into a hard 400 on every save, so it refused designs whose art was
visibly clear of the line — telling the customer to move something already where
it should be, with no way to save or send — while passing text rotated into the
band, which then printed clipped. The editor's own guide measures the rendered
node's client rect and has always been rotation-aware, so the screen and the
server disagreed in both directions.

**A returned card's reprint lost its QR destination.** The reprint deliberately
copies `occasionId`, `savedDesignId`, `documentSnapshot` and `postageClass` — and
omitted `messagePageId`, which was not even selected. Every other order-creation
path sets it. Settlement then read null, fell into its auto-page branch and
minted a fresh page titled "Your message", so the replacement card carried a
perfectly scannable code to a page the sender never wrote — for the one recipient
most certain to scan it, because this is the card that finally arrived.

## Decision

1. **One card-document builder, in `shared-types`.** The catalog's
   `buildCardDocument` and the web's `artworkDocument` had converged on
   identical output, so the web copy is not corrected — it is deleted, and both
   surfaces call the shared one. Artwork is a page **background**: full-bleed,
   centre-cropped, undistorted at any canvas size, and locked so text added over
   it cannot drag it. **There are no dimensions left in it to drift**, which is
   the durable half of the fix; correcting 600 to 634 would have left the same
   trap for the next canvas change.

2. **The footer check reads the rotated bottom edge.** `rotatedBottom` takes the
   lowest of the four rotated corners, the origin included. The band is a floor,
   so only the bottom edge matters — an earlier version carried the top of the
   span too, and mutation testing showed it cancelled out at the call site.

3. **The reprint copies `messagePageId`** alongside everything else it already
   copies, routing settlement down its existing branch: a fresh slug per card,
   the same page behind it.

## Consequences

- The editor and the save endpoint now agree about rotation in both directions.
  Some designs that previously saved — text rotated into the reserved band — will
  now be refused. That is the intended behaviour and the editor was already
  warning about them; the server simply was not enforcing what the screen said.
- Every guard is mutation-tested. Two survivors were worth more than the ones
  that failed: one showed dead arithmetic (the span's top cancelled out and the
  helper is simpler for losing it), and one showed a real coverage gap — no test
  used a rotation between 180° and 270°, where every corner but the origin lands
  above it, and dropping the origin from the reckoning made an element sitting on
  the line look 28 units clear of it.
- The old QR rotation test proved nothing: at 270° a zero width gives the same
  answer as the real one. It tests 90° as well now, where it does not.
- `buildCardDocument` gains a default for `insideMessage`, since a member's
  upload has none. A catalog record with no attachment still yields a plain white
  front rather than a dangling reference.
