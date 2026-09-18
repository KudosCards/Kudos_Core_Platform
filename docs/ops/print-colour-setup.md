# Choosing a media type, and getting the colour right

**For:** whoever is at the Canon imagePROGRAF PRO-310, with the real 300 gsm
"Extra White Smooth" blanks.
**Time:** about an hour for part 1. Part 2 only if part 1 is not good enough.
**Before you start:** the borderless calibration must already be entered in
Admin → Print setup. If it is not, do that first — this sheet is printed with
the same settings as a card, and if those are wrong you will be judging the
wrong thing.

---

## Why this exists

The blanks are not a Canon paper. The driver's "media type" list is a set of
recipes — how much ink to put down, how to dither it, what it assumes the paper
does to that ink — and there is no entry for our stock, so one has to be
borrowed. Borrowing the wrong one is the difference between a flat card and a
good one, and on a ten-ink pigment printer it is the biggest visible improvement
left in the whole print plan.

Nobody can choose it from a desk. It has to be printed.

**The software side is already done.** Every image now reaches the printer as
sRGB, converted from whatever the customer uploaded. So if a print comes back
wrong from here, it is the paper, the media type, or the driver — not the file.

---

## Part 1 — Find the media type (do this first)

### The sheet

`docs/research/2026-09-artwork-print/kudos-colour-test.pdf`, regenerated any
time with `pnpm --filter @kudos/api colour-test-sheet`.

It is A5 landscape, the same size as a folded-card sheet, and everything on it
sits 10 mm in from the edge so the borderless crop cannot eat a patch.

### Print settings — identical to a real card

| Setting    | Value                                                       |
| ---------- | ----------------------------------------------------------- |
| Paper size | **A5 borderless, LANDSCAPE** — 210 wide × 148 tall          |
| Scaling    | **100% / Actual size**. Never "Fit"                         |
| Quality    | whatever cards are printed at — keep it the same every time |
| Colour     | **let one thing manage colour, not two** — see below        |
| Media type | **the variable**. One print per candidate                   |

### Which media types to try

Read the driver's own list; the exact names differ by driver version. You want
the entries meant for **smooth, matte, uncoated or lightly-coated heavyweight
paper** — typically the fine-art / matte photo / heavyweight family, not the
glossy or semi-gloss ones. Three or four candidates is plenty.

> **Check borderless survives.** Some fine-art media types on Canon drivers
> force a margin and **disable borderless printing entirely**. If choosing a
> media type makes the borderless option disappear, that media type is out —
> or the whole folded-sheet approach changes, which is a bigger conversation.
> Please note down any candidate that does this rather than just skipping it.

**Label every sheet before you print it** — media type, quality, date, in the box
top right. An unlabelled print is a wasted sheet; you will not remember which was
which after the fourth one.

### How to read the results

Lay them side by side in **daylight or a daylight-balanced lamp**, not under
warm domestic bulbs. Colour judged under an orange bulb is not a judgement.

Work down in this order — the order is deliberate, because the first band tells
you whether the rest is even worth reading:

**1. The grey ramp.** Every patch is a true grey: red, green and blue set to the
same number. So **any colour you can see in them was added by the printer**.

- Greys look neutral → good, carry on.
- Greys have a consistent cast (pink, green, blue, yellow) → something is wrong,
  and it is probably **not** the media type. See _"If every option looks wrong"_
  below before you print any more.

**2. The saturated row.** The gamut edge, where media types differ most. Look at
the **Kudos red** especially — it is on real cards, and a saturated red on
uncoated stock is exactly the hard case. Is it clean and solid, or muddy, or
does it look orange?

**3. Skin tones.** What the recipient actually looks at, and where a small cast
shows first. All five patches should look like plausible skin, not sunburnt or
grey.

**4. The sweep.** Smooth, or stepped? Stripes or steps are a **quality setting**
problem, not a paper one — try the next quality level up before blaming the
media type.

**5. The dark block.** Two things:

- Is the paper **cockling** (rippling) under it? That is too much ink for this
  stock. The media type is laying down more than the paper can take.
- After printing, wait a few minutes, then lay a **blank sheet face-down on
  the block and press gently**. Does ink transfer? Note how long it takes
  before nothing transfers — see part 3, this number matters.

### What to send back

- The labelled sheets (photos are fine, in daylight, no flash).
- Which media type you would choose, and why in one line.
- Any candidate that **disabled borderless**.
- Any candidate that **cockled the paper**.

---

## If every option looks wrong in the same way

If the greys have the same cast on every media type you try, stop printing and
check this — it is the most common cause and no media type will fix it.

**Colour is probably being managed twice**: once by Acrobat/Preview and again by
the printer driver. Each does a conversion, and the second one is applied to
already-converted numbers.

Exactly one of these should be true:

- **Application manages colour** → in the print dialog set colour handling to the
  application, and in the driver set colour correction to **None / No colour
  adjustment**.
- **Printer manages colour** → in the print dialog set colour handling to the
  printer, and let the driver's colour correction do its normal job.

Either is fine. **Both at once is the fault.** If you are unsure which you have,
"printer manages colour, application does nothing" is the simpler one to set up
and is the right default for part 1.

---

## Part 2 — A custom ICC profile (only if part 1 is not good enough)

If the best media type is still visibly off — a cast you cannot get rid of,
saturated colours you cannot reach, dark tones blocking up — then the answer is
a profile made for **this paper on this printer with this ink**. That is what a
media type is approximating, and a real profile does it properly.

Three routes, cheapest first:

1. **Ask the paper supplier.** Many stock suppliers publish ICC profiles for
   common printers. Worth one email before spending anything — ask specifically
   for the imagePROGRAF PRO-310 and quote the exact stock name.
2. **A profiling service.** They send a target file, you print it **with all
   colour management turned off** (this is essential — the target must be printed
   raw, exactly as the numbers say), post them the print, and they return an ICC
   profile. Typically £30–£60 and a few days.
3. **DIY**, if there is already a spectrophotometer in the building. Otherwise
   not worth buying one for this.

**Using the profile once you have it:** install it, then in the print dialog
select it as the printer profile and set the driver's own colour correction to
**None / No colour adjustment**. The profile is now doing the conversion, so the
driver must not do a second one. This is the same "only one thing manages colour"
rule as above, and getting it wrong here is the usual reason a new profile looks
worse than no profile.

Keep the media type you chose in part 1 — the profile describes the ink the media
type lays down, so changing the media type afterwards invalidates it.

---

## Part 3 — Two questions we have never answered

You will be at the printer with the real stock, so please settle these while you
are there. Both have been open since the first calibration and neither needs any
software.

**Does the fold crack?** Fold a printed sheet across the middle, through an area
with heavy ink. 300 gsm with pigment over the crease may crack along the fold.

- If it cracks → scoring becomes a step in the process before folding. Tell us,
  and try a scored fold to confirm it fixes it.
- If it does not → good, and worth knowing for certain.

**How long before the second side?** The cards are manually duplexed: side one,
turn the stack, side two. If the stack is turned too soon the ink offsets onto
the sheet above. Using the dark block test above, note the shortest wait after
which nothing transfers, and round it up generously.

That number becomes a step in the print process, so please give it as a time —
"leave it five minutes" — rather than "wait until it feels dry".

---

## What happens next

Send back the media type, the answers to part 3, and whether you think a custom
profile is needed. The media type and the dwell time go into the print process;
if a profile is needed, that is a purchase decision rather than a code change.

None of this changes the software. The print engine already sends sRGB and the
folded-sheet geometry is calibrated — what is left is entirely about the paper.
