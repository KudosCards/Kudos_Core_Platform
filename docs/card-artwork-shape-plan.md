# The artwork is the wrong shape

The first real measurement of the catalog came back, and it says something we
did not know and did not guess: **207 of 217 designs lose exactly 6% of their
height.** Not a spread. One number, on 95% of the catalog.

This is the plan to end it.

## What is actually happening

Working backwards from that 6% with our own functions: only source artwork with
a height:width ratio between **1.4910 and 1.5065** reports "6% of the height".
That band is 3:2.

**The catalog is authored at 2:3. The card is A6 — 1:1.4095.**

A background is drawn full-bleed and centre-cropped, so every one of those 207
cards is printed with:

|                  |                                                                  |
| ---------------- | ---------------------------------------------------------------- |
| Source shape     | 2:3 (1:1.5)                                                      |
| Card             | 105 × 148 mm (1:1.40952)                                         |
| Height discarded | **8.93 mm — 4.46 mm off the top and 4.46 mm off the bottom**     |
| Verdict          | `noticeable` on every one; **nothing in the catalog is `heavy`** |

That is not 207 problems. It is one wrong export preset, applied 207 times.

### The correction this forces

`docs/card-artwork-crop-plan.md` led with a different theory — that a **square**
source losing 29% of its width was "the signature in the screenshot". That was a
hypothesis read off the shape of a crop, and the measurement refutes it: there
is **not one square source in the catalog**. The Jellyfish card that started the
whole investigation (KC-BDAY-GEN-007) is losing 6% of its _height_ — top and
bottom, not the sides.

The measuring work was right and it is what found this. The diagnosis on top of
it was wrong. That document is corrected in Phase 0 rather than left to rot.

## What is _not_ wrong

Checked, so we do not spend effort on things that are already correct:

- **The preview is honest.** The browser crops into the authored canvas
  (450:634); the PDF covers the trim page (105:148). Computed: they differ by
  **0.063 mm**. What an operator sees on screen is what comes off the press.
- **`coverCrop` is correct.** Full-bleed, undistorted, centred is the right
  rendering for a background.
- **The two renderers agree**, and the shipping PDF path passes `bleedMm: 0`, so
  the page _is_ the trim.
- **Phase 2's threshold was right.** Keeping `noticeable` out of the ops print
  run, on the argument that a line appearing on nearly every run gets scrolled
  past, would have fired on 207 of 217 cards. The judgement holds — but see D2,
  because "not per-card" was never the same as "silent".

## The fact everything else follows from

**No code change removes this crop.** A 2:3 image cannot fill a 1:1.4095 card
without one of: losing 6% of its height, gaining white bars down the sides
(3.2 mm each), or being stretched. Only the first is acceptable on a greeting
card, and it is what we already do.

So the fix is not in the renderer. **The fix is that the artwork must be the
right shape.** Everything below exists to make that happen, make it checkable,
and make it stick.

### The number to give the artwork supplier

**1240 × 1748 px.**

Exactly A6 at 300 dpi. Verified: loses 0% to the crop, and clears the existing
resolution pre-flight at the same time. One target satisfies both checks.

## Decisions

**D1 — Fix the source, not the software.** The previous plan's D1 ("measure the
loss, don't prevent it") was the right first move and it is what produced this
evidence. It is not the cure. The cure is 217 re-exports and a changed preset.

**D2 — Report once, not 207 times.** The ops print run says _nothing_ at 6%, and
the catalog panel prints 207 identical lines. Both are wrong in the same
direction: neither gives a person a fact they can act on. One aggregate
statement, plus the outliers by name.

**D3 — Show what is lost, before asking anyone to judge it.** 4.46 mm off each
edge is a margin on some cards and a decapitated character on others. Nobody can
tell from the cropped render — that is the one view guaranteed not to contain
the answer. Until we can _see_ the discarded band, "which of these 207 need
re-exporting" is a guess, and this plan refuses to guess.

**D4 — Do not tell a customer to fix artwork that is not theirs.** The editor
note now fires on ~95% of catalog designs, advising a re-export the customer
cannot perform. That is a defect introduced by the crop plan's Phase 4 and
exposed by this data.

**D5 — Close the bleed trap before it opens.** `backgroundCropLoss` measures
against the authored canvas. The renderer crops against the _page_, which equals
the trim only because the single shipping path passes `bleedMm: 0`.
`renderPdf` still defaults to 3 mm. Computed: on a 3 mm-bleed path, a 2:3 source
loses **11.1% of its height and 5.4% of its width** after trimming — `heavy` —
while we would go on reporting 6%. A print-house path is exactly what that
geometry module was built for, so this is a live trap, not a hypothetical.

**D6 — Art-directed cropping is now definitively out.** The previous plan
deferred this pending evidence. The evidence is in: the loss is uniform, small
and symmetric. A per-design crop-offset feature would be a large build to
choose _which_ 6% to throw away, when re-exporting throws away none.

**D7 — Do not touch `CARD_HEIGHT`.** 450 × 148/105 is 634.29 and the canvas is
634 — a third of a unit short, 0.05%. Correcting it would reflow the element
positions of every design ever saved. Not worth 0.04 mm.

## Phases

Each phase is its own PR, merged when green before the next starts.

### Phase 0 — Correct the record

- Amend `docs/card-artwork-crop-plan.md`: the square-source diagnosis was wrong,
  the real finding is 2:3, and point at this document.
- Land this plan alongside it.

A stale plan is worse than no plan — it is a confident wrong answer that
somebody will act on.

### Phase 1 — See what is being cut off

- Extend the existing **As printed / Full artwork** toggle so it reveals the
  cropped band on _any_ face, not only the back's reserved footer. Same
  affordance, same precedent (ADR 0166): draw the full source, mark the region
  that will not print.
- The band is drawn from `coverCropLoss`, so the picture and the percentage
  cannot disagree.

**This is the phase that matters most.** Everything after it is bookkeeping;
this is the one that replaces judgement-by-guess with judgement-by-looking, and
turns "re-export 217" into "re-export the 30 that actually lose something".

**Falsifying check**: a design known to be 2:3 must show a band of exactly
4.46 mm at the top and the bottom, and an A6-shaped one must show no band at all.

### Phase 2 — Say it once, with the numbers that matter

- **Ops print run**: one line stating the fact for the run — how many
  backgrounds are cropped and by how much in millimetres — instead of silence at
  `noticeable` and a wall at `heavy`. Individual naming reserved for outliers.
- **Catalog panel**: collapse identical losses into one group ("207 designs lose
  6% of their height — 2:3 artwork on a 1:1.409 card"), and list only the
  designs that differ.
- Both carry the **source pixel size and the target**, so the re-export brief
  writes itself from the screen.

### Phase 3 — Stop blaming the customer for our artwork

- The editor's crop note distinguishes a background the customer uploaded
  (actionable — keep the advice) from catalog artwork (not theirs to fix — say
  nothing, or say it as ours).

### Phase 4 — Measure the geometry we actually print

- `backgroundCropLoss` takes the geometry it is describing rather than assuming
  the canvas, so a bleed path reports 11.1%/5.4% instead of 6%.
- Tests pinning both paths, against the numbers in this document.

### Phase 5 — Keep it clean once it is clean

- The catalog sync gains the refusal D4 of the previous plan reserved for it —
  as an **ops-controlled setting, default off**.
- Off today, because switching it on now would refuse 207 of 217 designs and
  empty the catalog. On the day the re-export lands, ops turn it on and the
  problem cannot come back.

## What this does not fix

Every card already printed from a 2:3 design went out 8.93 mm short, and there
is no record of what was lost. Reprints after the re-export will be correct.
The cards in the post are not.
