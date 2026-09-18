# 0249 — The sheet the printer takes

## Status

Accepted

## Context

Phase 4 of docs/card-print-quality-plan.md.

The house printer is a Canon imagePROGRAF PRO-310, printing Kudos's own A5
300 gsm blanks, folded to A6, borderless, manual duplex. Three facts about that
machine decide the shape of the output, and the engine met none of them.

**There is no borderless A6 on this printer.** A card face cannot be a page. The
page has to be the A5 landscape sheet — 210 × 148 mm — that folds to one A6 card,
carrying two faces with the fold down the middle. The engine emitted one A6 face
per page, so the only way to print a folded card was the driver's 2-up, which
pairs pages in file order: front with inside-left, inside-right with back. That
is not a card.

**Borderless prints by enlarging.** The driver scales the page up and lets the
overhang fall off the paper. That is a crop of 1–3 mm per edge applied after the
PDF, to every card, including artwork that is exactly the right shape. Adding
bleed cannot help — content outside the page box never reaches the driver at all.

**Duplex is manual.** The operator prints one side, turns the stack, prints the
other. Which axis they turn it about decides whether the inside comes out
upright, and nothing in the software tested it.

A fourth thing was already wrong independent of the printer. A QR element on a
card with no message page drew the editor's grey placeholder square — a preview
affordance that was reaching real posted cards, where it reads as a printing
fault and scans as nothing.

## Decision

**The sheet is the page, and the panel is unchanged.**

`foldedSheetGeometry(size, overhangMm)` returns a landscape sheet whose two
panels are plain `faceGeometry(size, 0)` boxes tiling it exactly. The face
renderer was split so it draws relative to the current origin: every rule it
already enforces — the white base, the full-bleed background, the reserved
footer clip — applies inside a panel with no knowledge that a sheet exists. The
fold is the panels' shared edge, so there is no seam to line up.

Pages come out interleaved, outside then inside per card, which makes every
outside an odd page and every inside an even one — the order manual duplex wants.

Panel order is `back | front` outside and `inside-left | inside-right` inside.
The second is the part worth writing down: turning the stack about the sheet's
**short** edge mirrors it horizontally, so the panel printed on the right of
side one becomes the left of side two — which is the panel the card opens onto,
with top and bottom unmoved. The P0 duplex test printed an arrow on each side and
both came back pointing at the top edge, confirming that axis; a turn about the
long edge would have inverted the second and the insides would print upside-down.

**Borderless is compensated by drawing smaller, about the centre.**

`borderlessShrink(overhangMm, sheetWidthMm)` returns the exact inverse of the
driver's enlargement, `W / (W + 2·overhang)`, applied about the sheet's centre.
Centring gets both axes right from one measurement: the enlargement is uniform,
so the short edge loses proportionally less, and a centred scale reproduces that
without a second reading. At 0 it is exactly 1 and the sheet is drawn untouched —
which is both "nobody has calibrated yet" and the correct output for a printer
that is not enlarging, so the uncalibrated default is also a safe one.

**What centring assumes, and what would break it.** A centred scale corrects a
_symmetric_ enlargement — the same loss off the left as off the right. That is
what a borderless driver is supposed to do, and it is the only thing one number
can describe. It does not correct a sheet that is also fed or placed
**off-centre**: a feed shifted by `d` loses `overhang − d` on one edge and
`overhang + d` on the other, and no amount of centred scaling moves the card
sideways to meet it.

This is not hypothetical. A calibration print came back visibly off-centre, with
the full rulers intact and a white border — borderless never engaged, so the
offset is the driver's ordinary margins rather than a measured overhang, but it
is a printer that demonstrably does not place the sheet centrally. Correcting it
would need an offset term as well as a scale.

Nothing is wrong today: the overhang is 0, so no compensation is applied at all.
The risk is entirely in the future, at the moment somebody types a measured
figure into the panel under the assumption that one number is enough. So the
calibration sheet now reads **all four edges separately** and asks outright
whether the opposite pairs match (docs/card-print-quality-plan.md, P0). If they
do, this assumption is established rather than inherited and nothing changes. If
they do not, the offset gets built against a real measurement instead of a guess.

**A profile, not a per-run option.** `GET/PUT /admin/print/profile`, super-admin
gated, storing `layout`, `borderlessOverhangMm` and `backFooter` in the existing
PlatformSetting table. This describes the printer, not the run: ops choose a card
size per run, but they do not choose a different printer per run. Storing it
means the figure measured at the printer reaches the engine with no redeploy —
which matters, because the number cannot be known from here at all.

**No placeholder QR on a sheet.** The folded layout never draws it. A card with
no message page gets a plain band.

**`backFooter: "print"` exists but is not the default.** The stock in the
building is pre-printed with the mark and the caption, so drawing them would
overprint the branding. `"reserved"` stays the default and `"print"` is there for
when blank stock arrives — switched on after a proof, not before.

## Consequences

- The PDF an operator downloads is now a landscape sheet, not a card face. The
  two are easy to confuse at a glance, so the filename says which (`-folded`).
- `face-per-page` remains selectable. If a sheet comes out wrong at the printer,
  ops fall back without a deploy — which is why the old layout is kept rather
  than deleted, despite D11 eventually retiring the browser print path.
- A face a design does not carry prints blank. The single-face renderer falls
  back to the front for a missing face; on a sheet that would post the cover
  artwork on the back of the card, so the folded path looks the face up strictly.
- The compensation is scale-only. Should the four-edge reading come back
  asymmetric, `borderlessOverhangMm` alone cannot describe this printer and the
  profile needs an offset beside it — a schema change, not a tuning change.
- Until the calibration sheet is read, `borderlessOverhangMm` is 0 and the card
  prints at full size. If the driver _is_ enlarging, cards keep losing the same
  1–3 mm they lose today — no worse, and fixed by typing one number into the
  panel once someone at the printer measures it.
- The mark for the printed footer is fetched from the web origin through the
  existing allow-listed resolver, so no second copy is vendored into the API.

## Alternatives considered

- **Bleed instead of shrink.** Cannot work: the driver never sees content
  outside the page box, so bleed is discarded before the enlargement happens.
- **Measuring both edges.** The enlargement is uniform, so the short edge is
  derivable from the long one. A second reading is a second thing to get wrong.
- **Rotating the inside panels.** Only correct for a long-edge turn. The test
  says this printer's operator turns it about the short edge, and hard-coding the
  other would print every card's inside upside-down.
- **Making `backFooter: "print"` the default.** Correct for the blank stock the
  plan anticipates, wrong for the pre-printed stock in the building today.
