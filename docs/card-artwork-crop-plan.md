# The artwork we throw away

A super admin opened a card in the order cockpit and said the artwork looked cut
off at the edges. It is. This is what is happening, what is not happening, and
what we are going to do about it.

## What is happening

A catalog card's artwork is not an image _element_. `buildCardDocument`
(`apps/api/src/catalog/card-document.util.ts`) stores it as a page
**background**, and every renderer draws a background full-bleed, centre-cropped
to the card's proportion:

- the browser preview — `apps/web/src/components/page-background.tsx`, `coverCrop` into 450×634
- the print-ready PDF — `apps/api/src/print-pdf/render.ts`, pdfkit `cover` into the page box

The card is 450:634 — **1:1.409**, the A6 proportion (105×148 mm). Artwork of any
other shape loses its edges. Computed from our own `coverCrop`:

| source artwork | kept  | cropped off _each_ side |
| -------------- | ----- | ----------------------- |
| square (1:1)   | 71.0% | **14.5%**               |
| 4:5 portrait   | 88.7% | 5.6%                    |
| 3:4 portrait   | 94.6% | 2.7%                    |
| 5:7 portrait   | 99.4% | 0.3%                    |
| A6 (105:148)   | 100%  | —                       |
| landscape 3:2  | 47.3% | 26.3%                   |

A square source — the default output of most illustration tools — loses **29% of
its width**. That is the signature in the screenshot: a composition sliced by a
hard vertical line at the card edge.

**Nothing measures this.** The pre-flight in the print overlay checks resolution
only: it will say an image is soft and stay silent while a third of it is
discarded. The catalog sync never measures image dimensions at all — no `sharp`
call, no stored width or height on `CardDesign`. Artwork goes from Airtable to a
printed card without anything ever asking what shape it is.

Two stale beliefs sit on top of this:

- `print-run-overlay.tsx` says the back is "the one face whose render is
  unfaithful by design", which is why _Download original artwork_ appears on the
  back only. The front is unfaithful too, on every design whose background is not
  A6-proportioned — and it is the face you would want the original of.
- `print-quality.ts` says its `mmPerUnit` "matches the renderer's geometry and
  `fittedCardMm`". It matches the renderer. It does not match `fittedCardMm`.

## What is _not_ wrong

Worth stating, so we do not fix things that are already right:

- **The customer sees the same crop they get.** The catalog tile and the template
  picker both render `thumbnailUrl` with `object-cover` into an
  `aspect-[105/148]` box — the same centre-crop as the card. We are not selling a
  picture and posting a different one.
- **The two renderers agree.** The browser crops into 450:634 (1.40889); the PDF
  covers a 105×148 page (1.40952). A 0.05% difference — not a source of drift.
- **`coverCrop` itself is correct.** Full-bleed and undistorted is the right
  behaviour for a background. The fault is that it is silent.

## The second finding: the preview is not the geometry that prints

|                                           | card on a 105×148 page                | margin                       |
| ----------------------------------------- | ------------------------------------- | ---------------------------- |
| Preview (`fittedCardMm`)                  | 95.00 × 133.84 mm — 81.8% of the page | 5mm sides, 7.08mm top/bottom |
| Print-ready PDF (`faceGeometry`, bleed 0) | 105.00 × 147.93 mm, full bleed        | none                         |

The PDF card is **1.105× wider** than the one an operator is looking at. The 5mm
inset is deliberate — it keeps artwork out of an office printer's unprintable
margin on the _Browser print_ path — but it means the preview cannot answer the
question it is being asked. "Does the artwork reach the edge, is something being
cut at the trim" is invisible in a view that floats the card inside a white
border the real output does not have.

## Decisions

**D1 — Measure the loss, don't prevent it.** Full-bleed centre-crop stays. It is
the right rendering for a background and changing it would letterbox every card
we have ever sold. What changes is that the loss becomes a number somebody can
see.

**D2 — One pure definition, like the DPI pre-flight.** The crop maths goes in
`shared-types` beside `print-quality.ts`, so the editor, the ops overlay and the
catalog sync cannot disagree about how much is being thrown away.

**D3 — Three buckets, not a boolean.** Mirroring `printDpiVerdict`: `ok` (≤2% of
an axis lost), `noticeable` (≤10%), `heavy` (>10%). A square source lands in
`heavy`, 3:4 in `noticeable`, 5:7 in `ok`. The numbers are a starting position
with a test pinning them, not a law.

**D4 — Warn everywhere, block at one place only.** Ops and the editor warn. The
catalog sync is the only place that can refuse, because it is the only place
where the artwork is ours and a person can go and fix it before a customer ever
sees it. Even there we flag before we block — see Phase 5.

**D5 — The preview gets honest, not re-geometried.** We do not move the 5mm
inset: it is load-bearing for office printing. We draw the trim edge and say in
the toolbar what the PDF actually is. Changing the preview's geometry to match
print would silently break the Browser print path, which is a worse bug than the
one we are fixing.

**D6 — Not in scope: art-directed cropping.** Letting someone choose _which_
part of a non-conforming image survives (a crop offset per design) is a real
feature and a bigger one. If the measurements in Phase 5 say a lot of the catalog
is heavily cropped, that is the argument for building it, and we will have the
evidence rather than the hunch.

## Phases

Each phase is its own PR, merged when green before the next starts.

### Phase 1 — Measure it, in one place

- `coverCropLoss(natural, box)` and `cropVerdict(...)` in `shared-types`,
  beside the DPI pre-flight, returning the fraction lost per axis and a bucket.
- `collectPrintImageTargets` already walks every background and image element;
  extend the target so a caller can ask about crop as well as resolution.
- Correct the three stale comments (`print-quality.ts` `mmPerUnit`,
  `print-run-overlay.tsx` "the one face", the "authored 3:4" header that predates
  #284).
- Pure, unit-tested, no behaviour change. **Falsifying check**: the table above
  is reproduced as test cases; if the code disagrees with it, one of the two is
  wrong and we find out here.

### Phase 2 — The operator can see it

- A crop warning in the print-run overlay beside the low-resolution one, naming
  the design and the loss: "29% of this artwork's width is not printed".
- _Download original artwork_ on every face, not just the back — the reason it
  was back-only stopped being true the moment a front background could be
  cropped.

### Phase 3 — The preview stops implying a border

- Draw the trim edge on the previewed page and state plainly in the toolbar that
  the print-ready PDF is full-bleed at the trim size while this view is inset 5mm
  for office printers.

### Phase 4 — The customer is told before they buy

- The design editor warns when a background image will be materially cropped, at
  the moment it is set — the same verdict, same wording, the surface where it can
  still be fixed for free.

### Phase 5 — Measure at the door

- The catalog sync already holds the artwork bytes in a Buffer in `copyImage`;
  one `sharp` metadata call measures it with no extra download.
- Store natural width/height on `CardDesign` and surface the verdict in the ops
  catalog panel, so "which of our designs are being cut up" is a question with an
  answer.
- Then, and only then, decide whether a `heavy` verdict should refuse the sync.
  Blocking first would risk emptying the catalog over a threshold nobody has
  tested against real artwork.

## What this does not fix

The cards already printed. Every card sold from a non-conforming design was
printed cropped, and there is no record of what was lost because nothing measured
it. Phase 5 is what makes the question answerable going forward; it cannot look
backwards.
