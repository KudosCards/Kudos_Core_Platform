# 0251 — The paper is not where the driver thinks

## Status

Accepted

## Context

ADR 0249 compensated borderless printing by drawing the sheet smaller, scaled
about its centre, and recorded the assumption that made that enough:

> A centred scale corrects a _symmetric_ enlargement … It does not correct a
> sheet that is also fed or placed **off-centre** … Should the four-edge reading
> come back asymmetric, `borderlessOverhangMm` alone cannot describe this printer
> and the profile needs an offset beside it — a schema change, not a tuning
> change.

The first calibration print that actually engaged borderless came back
asymmetric.

| edge   | ink lost |
| ------ | -------- |
| top    | 2.0 mm   |
| bottom | 2.0 mm   |
| left   | 1.5 mm   |
| right  | 5.0 mm   |

Two faults, not one, and they separate cleanly:

- **A uniform enlargement.** The symmetric part is `(left + right) / 2` =
  3.25 mm per long edge and `(top + bottom) / 2` = 2 mm per short edge. Those
  imply the same ~3% enlargement to within the sheet's 0.5 mm steps (the long-axis
  figure predicts 2.29 mm on the short axis against 2.0 measured), so one
  enlargement explains both axes. This is what ADR 0249 already corrects.
- **A placement offset.** `(left − right) / 2` = −1.75 mm: the printer puts the
  sheet 1.75 mm right of where the driver believes it is. `(top − bottom) / 2`
  = 0, so the vertical placement is true.

The operator's reading of this was to shift the artwork 1.75 mm left and leave
its size alone. The first half is right. The second would leave 3.25 mm of every
customer's design being cut off every long edge, which is the loss P4 exists to
remove — and the losses themselves are the evidence of the enlargement, because a
page printed at true size has nothing to lose.

The reverse mistake is worse. Correcting the scale _without_ the offset would
size the card to the paper exactly and then place it 1.75 mm off, putting a strip
of bare white paper down one edge of a finished card.

## Decision

**Two corrections, because there are two faults.**

`PrintProfile` gains `borderlessOffsetXMm` and `borderlessOffsetYMm`, taken
straight off the calibration sheet as `(left − right) / 2` and
`(top − bottom) / 2`. The renderer translates the sheet by that much before the
existing centred scale. A negative X moves the card left, which is what a printer
running right needs.

The shift carries the shrink (`borderlessShiftMm`), because the driver enlarges
the translation along with everything else: a shift of `d` on the page lands as
`d ÷ shrink` on the paper. On a 1.75 mm correction that is 0.05 mm — not a
difference anyone can see, and not a reason to write it down wrong.

**The compensation deliberately stops short of exact.**

`BORDERLESS_SAFETY_MM` (1 mm) is subtracted from the measured overhang before the
shrink is computed, so the card is drawn to overrun the paper by about a
millimetre and that much background is thrown away on purpose.

Compensating exactly makes the card fill the paper exactly, and this printer
demonstrably does not place every sheet identically — the 1.75 mm offset is the
proof. Correcting to zero would turn any wander in the feed into a white sliver
down the edge of a finished card. Losing a millimetre of background is the
cheaper failure by a wide margin.

An overhang at or inside the safety band is left alone entirely, rather than
corrected to a negative.

## Consequences

- With 3.25 mm entered, each long edge loses ~1 mm of background instead of
  3.25 mm, and the card sits centred. The design keeps the other 2.25 mm.
- The safety margin is a judgement, not a measurement. One sheet says where the
  feed sat; it does not say how far it wanders. Several prints would, and this is
  the number to revisit when they exist.
- The residual on paper is `BORDERLESS_SAFETY_MM × shrink` rather than the
  nominal figure, because the margin is subtracted in page space and the driver
  then enlarges what is left. Across the whole allowed range that is within a
  tenth of a millimetre of nominal.
- Vertical placement is true on this printer, so `borderlessOffsetYMm` is 0. It
  exists anyway: the axis that is true today is not guaranteed to stay true, and
  discovering that with no field to put it in is how this ADR happened.

## Alternatives considered

- **Offset only, as suggested.** Centres the card and leaves 3.25 mm of every
  design cut off each long edge. The suggestion reads the print as the right size
  in the wrong place; the losses on all four edges are what says it is not.
- **Scale only.** The correct size, then placed 1.75 mm off — a bare white strip
  down one edge of a finished card. Strictly worse than shipping neither.
- **Exact compensation, no safety margin.** Correct for a printer that places
  every sheet identically. This one does not.
- **Deriving the offset in code from four stored readings.** Tempting, since the
  sheet already asks for four numbers. Rejected: it puts arithmetic between what
  was measured and what is applied, and the profile would then carry readings
  from one print as though they were the printer's settled behaviour.
