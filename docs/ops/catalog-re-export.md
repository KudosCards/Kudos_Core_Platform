# Re-exporting the card catalog

For the ops director and whoever produces the artwork. This is the last step
that stops cards going out the wrong shape.

## Why

A card is 105 × 148 mm. A background fills it edge to edge, centred, and cropped
to fit — so artwork of any other shape loses its sides, or its top and bottom.

Almost the whole library is authored at 2:3, which is a taller rectangle than a
card. **6% of the height of each of those designs is not printed.** On a 148 mm
card that is 8.9 mm, gone off the top and bottom: a border, the top of a
character's head, the last line of a signature.

The print engine has been fixed. The designs have not. Until they are
re-exported, every card from a 2:3 design still goes out short.

## Where it stands

The catalog refresh on 18 September reported:

|                           |         |
| ------------------------- | ------- |
| Fetched                   | 217     |
| Updated                   | 217     |
| Images copied             | 217     |
| **Artwork being cropped** | **207** |
| Artwork not copied        | 0       |
| Errors                    | 0       |
| Clashing names            | 2       |
| Shared product codes      | 8       |

**207 of 217 designs still lose 6% of their height.** That run refreshed the
catalog from Airtable; it did not change any artwork, because nothing in
Airtable had changed yet. Ten designs are already the right shape.

The "Refuse artwork that would be cropped" switch is **off**, which is correct.
Turning it on now would refuse 207 of 217 designs on the next sync and empty the
shop. It goes on at step 5, not before.

## Step 1 — Fix the shared product codes first

**Do this before the re-export list is handed to anyone.**

Eight cards share four product codes:

| Code                       | The two cards on it                                          |
| -------------------------- | ------------------------------------------------------------ |
| `KC-INSPIRATIONAL-GEN-011` | Lewis Carroll - Cards · Henry Fielding Habits, Lewis Carroll |
| `KC-BDAY-GEN-029`          | Birthday Stars, Rainbow Cupcake                              |
| `KC-BDAY-GEN-030`          | Birthday Beige Balloons, Blue Frame Birthday                 |
| `KC-TEACHER-GEN-004`       | Teacher Flowers, Teacher Thank You                           |
| `KC-WELL DONE-GEN-024`     | Excellent work, Well Done - Your a star                      |
| `KC-WELL DONE-GEN-025`     | Simple Bear Well Done, Well Done - Huge Star                 |
| `KC-WELL DONE-GEN-027`     | Well Done - Yi-Pea, Well Done Pink Flowers                   |
| `KC-WELL DONE-GEN-028`     | Well Done - Stripes Well Done, Well Done Orange              |

Nothing is keyed on the code, so no card is broken today. But every list the
catalog page prints reads `Title (SKU)`, and the re-export list is handed to
somebody else to work through. **Two cards on one code cannot be worked from** —
whoever is exporting cannot tell which file replaces which.

Give each card its own code in Airtable, then re-run the refresh and confirm
"Shared product codes: 0".

## Step 2 — Re-export every design at 1748 × 2480

**1748 × 2480 pixels**, PNG or high-quality JPEG, no transparency needed.

That is A5 at 300 dpi. It is the master size rather than the A6 size for one
reason: **A5 is a supported card size in the platform.** A master at 1240 × 1748
is exactly right for A6 and only 213 dpi on A5, so the day an A5 card is sold
every design would need exporting a second time. 1748 × 2480 is 300 dpi at
either size.

> **Note the catalog page says 1240 × 1748.** That is not a contradiction — it
> is the exact A6 figure, and both sizes pass the shape check (1240 × 1748 loses
> 0.06% of its height against the card, 1748 × 2480 loses 0.70%, and anything
> under 2% is not worth mentioning). Export at **1748 × 2480** anyway, so this
> is done once.

Re-export all 217. Working from a list of 207 exceptions is slower and more
error-prone than doing the lot, and the ten that are already correct lose
nothing by being exported again at the master size.

**Do not crop to fit.** Re-export from the source artwork at the new canvas so
the composition is re-made for the card's shape. Cropping the existing 2:3
export to 1748 × 2480 throws away exactly the 6% this whole exercise is about.

## Step 3 — Re-attach in Airtable

Replace the image in the **Front Image** column for each card. The sync reads
that column by name; renaming it silently changes what gets imported.

## Step 4 — Refresh and check

Ops → Card catalog → **Refresh catalog from Airtable**.

The one number that matters: **Artwork being cropped: 0**.

If it is not zero, the page names what is still wrong and by how much. The usual
causes, in order:

- **An export that was cropped rather than re-made** — still the wrong shape,
  just at a new size.
- **A card whose image did not get replaced** in Airtable.
- **"Artwork not copied" above zero** — the image failed to download; re-run the
  refresh before investigating, it is usually transient.

Do not go to step 5 until this reads zero.

## Step 5 — Close the gate

Only once step 4 reads zero: tick **"Refuse artwork that would be cropped"** on
the same page.

From then on, a design that is the wrong shape is refused at import rather than
imported and quietly cut. The card keeps whatever artwork it already had, and
the sync says which design and why — so a bad export is caught on the day it is
made instead of on a card in someone's hand.

## Step 6 — Re-sync unprinted orders

Orders already placed still reference the old artwork. Any that have not yet
printed should be re-synced so they pick up the re-exported files.

Orders already **printed and posted** cannot be fixed. Every card from a 2:3
design that has already gone out went out 8.9 mm short. There is no record of
which, because nothing measured it at the time.

## Two other things the sync reported

Neither blocks the re-export. Both are worth fixing while the catalog is open.

**Two cards, one address.** `/thank-you-red` and `/well-done-flowers` each have
a second card claiming the same URL, which keeps a `-2` on the end of its
address for ever, even if renamed. A card's URL is assigned once and never
recalculated, because changing it would break indexed links and the QR codes on
cards already posted. Worth fixing before those cards are published.

**93 cards with no landing page.** seasonal (54), inspirational (22), fitness
themed (10) and good luck (7) sit under `/cards/other`, which is deliberately
not indexed. They sync, they browse, and their own pages are indexable — there
is just no category page for anyone to find them through. Either name the
categories properly or correct the value upstream.
