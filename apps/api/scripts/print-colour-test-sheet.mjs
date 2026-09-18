#!/usr/bin/env node
/**
 * Generates the colour test sheet for choosing a media type on the house
 * printer.
 *
 * Usage:
 *   node scripts/print-colour-test-sheet.mjs [out.pdf]
 *   pnpm --filter @kudos/api colour-test-sheet
 *
 * WHAT IT IS FOR
 *
 * Kudos prints on its own 300 gsm "Extra White Smooth" blanks, which are not a
 * Canon medium. The driver's media types are recipes — how much ink to lay
 * down, how to dither it, what it assumes the paper does to that ink — and one
 * of them has to be borrowed. Borrowing the wrong one is the difference between
 * a flat card and a good one, and on a ten-ink pigment printer it is the single
 * biggest visible quality step left (docs/card-print-quality-plan.md, P5).
 *
 * Nobody can pick it from a desk. This sheet makes the comparison possible: one
 * print per candidate media type, all the same file, judged side by side.
 *
 * WHAT EACH BAND IS FOR, IN THE ORDER THEY MATTER
 *
 * 1. The grey ramp is the whole test in one row. Greys are neutral by
 *    construction here — every patch has red, green and blue set to the same
 *    number — so any colour visible in them was added by the printer. A cast
 *    through the greys means the media type is wrong or, far more often, that
 *    colour is being managed twice: once by the application and again by the
 *    driver. That is the most common way a print comes back wrong and the
 *    hardest to spot on a photograph, where nobody knows what the original
 *    looked like.
 *
 * 2. The saturated row is the gamut edge, where media types differ most. The
 *    Kudos red is there because it is on real cards and because a saturated red
 *    on uncoated stock is exactly what a borrowed media type gets wrong.
 *
 * 3. Skin tones are what a recipient actually looks at, and the thing a small
 *    cast ruins first.
 *
 * 4. The sweep shows banding, which is a quality-setting problem rather than a
 *    media one, and worth knowing apart from the rest.
 *
 * 5. The solid block is an ink-load test, and it is the one that matters for
 *    this process specifically: the cards are manually duplexed, so ink that is
 *    too heavy for the paper cockles it, dries slowly, and transfers onto the
 *    next sheet when the stack is turned.
 *
 * Everything sits at least 10 mm from the page edge so the borderless
 * enlargement cannot clip a patch — three times the 3.25 mm this printer was
 * measured to crop. The sheet is the same 210 x 148 as a folded
 * card sheet, and is meant to be printed with the identical driver settings, so
 * what it shows is what a card will do.
 */

import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import PDFDocument from "pdfkit";

const MM = 72 / 25.4;
const SHEET = { widthMm: 210, heightMm: 148 };
/** Clear of anything the borderless pass could crop. */
const MARGIN = 10;

const rgb = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Neutral by construction: R = G = B, so any colour in them is the printer's. */
const GREYS = [26, 51, 77, 102, 128, 153, 179, 204, 230].map((v) => ({
  hex: rgb(v, v, v),
  label: `${Math.round((v / 255) * 100)}%`,
}));

const SATURATED = [
  { hex: "#000000", label: "black" },
  { hex: "#ff0000", label: "red" },
  { hex: "#00ff00", label: "green" },
  { hex: "#0000ff", label: "blue" },
  { hex: "#00ffff", label: "cyan" },
  { hex: "#ff00ff", label: "magenta" },
  { hex: "#ffff00", label: "yellow" },
  // On real cards, and a saturated red on uncoated stock is the hard case.
  { hex: "#e5372a", label: "Kudos red" },
];

const SKIN = [
  { hex: "#f4dac6", label: "" },
  { hex: "#deb294", label: "" },
  { hex: "#ba8664", label: "" },
  { hex: "#784e36", label: "" },
  { hex: "#4a3022", label: "" },
];

function patchRow(doc, { x, y, width, height, swatches, title, note }) {
  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor("#000000")
    .text(title, x * MM, y * MM, { width: width * MM, lineBreak: false });
  if (note) {
    doc
      .font("Helvetica")
      .fontSize(6.2)
      .fillColor("#444444")
      .text(note, (x + 30) * MM, y * MM, { width: (width - 30) * MM, lineBreak: false });
  }

  const top = y + 3.4;
  const gap = 1.2;
  const each = (width - gap * (swatches.length - 1)) / swatches.length;
  swatches.forEach((swatch, index) => {
    const left = x + index * (each + gap);
    doc.rect(left * MM, top * MM, each * MM, height * MM).fill(swatch.hex);
    if (swatch.label) {
      doc
        .font("Helvetica")
        .fontSize(5.4)
        .fillColor("#444444")
        .text(swatch.label, left * MM, (top + height + 0.8) * MM, {
          width: each * MM,
          align: "center",
          lineBreak: false,
        });
    }
  });
  return top + height + (swatches.some((s) => s.label) ? 4.2 : 1.8);
}

/** A continuous black-to-white sweep, for banding. */
function sweep(doc, { x, y, width, height }) {
  const steps = 160;
  for (let i = 0; i < steps; i += 1) {
    const value = Math.round((i / (steps - 1)) * 255);
    doc
      .rect((x + (i * width) / steps) * MM, y * MM, (width / steps) * MM + 0.4, height * MM)
      .fill(rgb(value, value, value));
  }
}

function build(outPath) {
  const doc = new PDFDocument({
    size: [SHEET.widthMm * MM, SHEET.heightMm * MM],
    margin: 0,
    info: { Title: "Kudos colour test — A5 landscape" },
  });
  const stream = createWriteStream(outPath);
  doc.pipe(stream);

  const width = SHEET.widthMm - MARGIN * 2;
  let y = MARGIN;

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#000000")
    .text("Kudos colour test", MARGIN * MM, y * MM, { lineBreak: false });

  // The label is the point of the whole exercise: one print per media type,
  // compared side by side, and an unlabelled print is a wasted sheet.
  const boxW = 86;
  const boxX = SHEET.widthMm - MARGIN - boxW;
  doc
    .save()
    .strokeColor("#000000")
    .lineWidth(0.25 * MM)
    .rect(boxX * MM, y * MM, boxW * MM, 11 * MM)
    .stroke()
    .restore();
  doc
    .font("Helvetica")
    .fontSize(6.4)
    .fillColor("#444444")
    .text(
      "MEDIA TYPE / QUALITY / DATE — fill this in before you print",
      (boxX + 2) * MM,
      (y + 1.6) * MM,
      { width: (boxW - 4) * MM, lineBreak: false },
    );
  y += 12.5;

  doc
    .font("Helvetica")
    .fontSize(6.6)
    .fillColor("#444444")
    .text(
      "Print exactly as a card: A5 landscape borderless, 100% / Actual size, the same quality setting. " +
        "One sheet per media type you are trying, labelled above.",
      MARGIN * MM,
      y * MM,
      { width: width * MM },
    );
  y += 7;

  y = patchRow(doc, {
    x: MARGIN,
    y,
    width,
    height: 13,
    swatches: GREYS,
    title: "Neutral greys",
    note: "read these first — every one is a true grey, so any colour you can see was added by the printer",
  });

  y = patchRow(doc, {
    x: MARGIN,
    y: y + 1,
    width,
    height: 13,
    swatches: SATURATED,
    title: "Saturated",
    note: "the gamut edge, where media types differ most",
  });

  y = patchRow(doc, {
    x: MARGIN,
    y: y + 1,
    width,
    height: 12,
    swatches: SKIN,
    title: "Skin",
    note: "what a recipient looks at, and what a small cast ruins first",
  });

  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor("#000000")
    .text("Sweep", MARGIN * MM, (y + 1) * MM, { lineBreak: false });
  doc
    .font("Helvetica")
    .fontSize(6.2)
    .fillColor("#444444")
    .text(
      "look for steps or stripes — that is the quality setting, not the paper",
      (MARGIN + 30) * MM,
      (y + 1) * MM,
      { lineBreak: false },
    );
  sweep(doc, { x: MARGIN, y: y + 4.4, width: width - 46, height: 10 });

  // Ink load: the one that decides whether a manually duplexed stack can be
  // turned without transferring onto the sheet above it.
  const blockX = SHEET.widthMm - MARGIN - 44;
  doc.rect(blockX * MM, (y + 4.4) * MM, 44 * MM, 10 * MM).fill("#1a1a2e");
  doc
    .font("Helvetica")
    .fontSize(5.6)
    .fillColor("#444444")
    .text(
      "heaviest ink — check for cockling, and for transfer when you turn the stack",
      blockX * MM,
      (y + 15.2) * MM,
      { width: 44 * MM, lineBreak: false },
    );

  doc.end();
  return new Promise((done, fail) => {
    stream.on("finish", () => done(y + 20));
    stream.on("error", fail);
  });
}

const out = resolve(process.argv[2] ?? "kudos-colour-test.pdf");
const bottomMm = await build(out);
if (bottomMm > SHEET.heightMm - MARGIN) {
  console.error(
    `WARNING: content reaches ${bottomMm.toFixed(1)} mm of a ${SHEET.heightMm} mm sheet.`,
  );
}
console.log(
  `Wrote ${out} — ${SHEET.widthMm} x ${SHEET.heightMm} mm, content ends at ${bottomMm.toFixed(1)} mm`,
);
