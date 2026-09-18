#!/usr/bin/env node
/**
 * Generates the borderless calibration sheet for the house printer.
 *
 * Usage:
 *   node scripts/print-calibration-sheet.mjs [out.pdf]
 *   pnpm --filter @kudos/api calibration-sheet
 *
 * This exists as a script rather than a checked-in PDF because the previous
 * sheet was a binary nobody could regenerate: when it turned out to be asking
 * the wrong question, the only options were to reverse-engineer it or to send
 * it again unchanged. Three prints came back unusable that way.
 *
 * WHAT THE SHEET IS FOR
 *
 * `borderlessOverhangMm` in Admin -> Print setup tells the PDF engine how much
 * the driver's borderless pass enlarges by, so it can draw each sheet that much
 * smaller and land the trim on the paper edge (docs/adr/0249). Nobody can know
 * that number from a desk; it comes off a real print on the real stock.
 *
 * WHAT IT ASKS, AND WHY IT CHANGED
 *
 * 1. *Did borderless engage at all?* The perimeter band runs off all four edges.
 *    Any white paper outside it means the driver never expanded the page, and
 *    every other reading on the sheet is meaningless. Three previous attempts
 *    failed here and it took a photograph to notice, because the old sheet had
 *    no single element that answered this.
 *
 * 2. *How much does each edge lose?* Eight steps per edge, 0.5 mm to 5 mm. The
 *    shallowest step still visible is just deeper than that edge's loss.
 *
 * 3. *Is the loss symmetric?* The old sheet asked for one long-edge figure,
 *    which silently assumed it was. A printed sheet that came back visibly
 *    off-centre put that in doubt, and a centred compensation cannot correct an
 *    off-centre feed. So all four edges are read separately, and the sheet asks
 *    outright whether LEFT equals RIGHT. Same-sized ink on all four edges is a
 *    fact worth establishing, not an assumption worth inheriting.
 *
 * The full frames are the other half of question 3: they run the length of the
 * sheet, so a feed that is shifted sideways shows up as frames cut on one side
 * and intact on the other, which is far easier to see than comparing two
 * numbers.
 */

import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import PDFDocument from "pdfkit";

/** PDF points per millimetre. */
const MM = 72 / 25.4;

/** The sheet one A6 card folds from — A5 landscape. Must match foldedSheetMm("A6"). */
const SHEET = { widthMm: 210, heightMm: 148 };

/** Depths, in mm, of the measurement steps at the middle of each edge. */
const STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];

/** Depths, in mm, of the frames that run the whole way round. */
const FRAMES = [0.5, 1, 2, 3, 4, 5];

/** How far in the perimeter band reaches. Deeper than the deepest frame so the
 *  frames sit on it and stay readable. */
const BAND_MM = 7;

const EDGES = ["top", "right", "bottom", "left"];

/**
 * Map a point on one edge to the page.
 *
 * `along` runs the length of that edge and `depth` runs inward from it, so the
 * same drawing code serves all four without rotating the page underneath it.
 */
function at(edge, along, depth) {
  const { widthMm: w, heightMm: h } = SHEET;
  if (edge === "top") return { x: along, y: depth };
  if (edge === "bottom") return { x: along, y: h - depth };
  if (edge === "left") return { x: depth, y: along };
  return { x: w - depth, y: along };
}

/** The length of an edge, in mm. */
const edgeLength = (edge) => (edge === "top" || edge === "bottom" ? SHEET.widthMm : SHEET.heightMm);

/** A rectangle that starts at `edge` and reaches `depth` inward. */
function stepRect(edge, along, widthAlong, depth) {
  const a = at(edge, along, 0);
  const b = at(edge, along + widthAlong, depth);
  return {
    x: Math.min(a.x, b.x) * MM,
    y: Math.min(a.y, b.y) * MM,
    w: Math.abs(b.x - a.x) * MM,
    h: Math.abs(b.y - a.y) * MM,
  };
}

function drawBand(doc) {
  const { widthMm: w, heightMm: h } = SHEET;
  doc.save().fillColor("#000000", 0.22);
  // Four bars rather than one outlined rect: an even-odd hole would also swallow
  // anything drawn under it later.
  doc.rect(0, 0, w * MM, BAND_MM * MM).fill();
  doc.rect(0, (h - BAND_MM) * MM, w * MM, BAND_MM * MM).fill();
  doc.rect(0, 0, BAND_MM * MM, h * MM).fill();
  doc.rect((w - BAND_MM) * MM, 0, BAND_MM * MM, h * MM).fill();
  doc.restore();
}

function drawFrames(doc) {
  const { widthMm: w, heightMm: h } = SHEET;
  doc
    .save()
    .strokeColor("#000000")
    .lineWidth(0.2 * MM);
  for (const inset of FRAMES) {
    doc.rect(inset * MM, inset * MM, (w - 2 * inset) * MM, (h - 2 * inset) * MM).stroke();
  }
  doc.restore();
}

function drawSteps(doc, edge) {
  const { widthMm: w, heightMm: h } = SHEET;
  const stepWidth = 11;
  const gap = 2;
  const run = STEPS.length * stepWidth + (STEPS.length - 1) * gap;
  const start = (edgeLength(edge) - run) / 2;
  const boxMm = 9;

  doc.save();
  STEPS.forEach((depth, index) => {
    const along = start + index * (stepWidth + gap);
    const block = stepRect(edge, along, stepWidth, depth);
    doc.rect(block.x, block.y, block.w, block.h).fillColor("#000000", 1).fill();

    // Every number reads the same way up. Rotating them to face their own edge
    // would mean turning the sheet four times to take four readings, on a sheet
    // whose whole point is comparing one edge against the opposite one.
    //
    // They sit just inside the band, where nothing can cut them off, and well
    // clear of the instructions in the middle.
    const centre = along + stepWidth / 2;
    let x;
    let y;
    let align;
    if (edge === "top" || edge === "bottom") {
      x = centre - boxMm / 2;
      y = edge === "top" ? BAND_MM + 1.8 : h - BAND_MM - 1.8 - 2.4;
      align = "center";
    } else {
      x = edge === "left" ? BAND_MM + 1.5 : w - BAND_MM - 1.5 - boxMm;
      y = centre - 1.2;
      align = edge === "left" ? "left" : "right";
    }

    doc
      .font("Helvetica-Bold")
      .fontSize(6.5)
      .fillColor("#000000")
      .text(String(depth), x * MM, y * MM, { width: boxMm * MM, align, lineBreak: false });
  });
  doc.restore();
}

/** The fold, so the sheet is recognisably the one a card folds from. */
function drawFold(doc) {
  const { widthMm: w, heightMm: h } = SHEET;
  doc
    .save()
    .strokeColor("#000000", 0.35)
    .lineWidth(0.15 * MM)
    .dash(2 * MM, { space: 2 * MM })
    .moveTo((w / 2) * MM, BAND_MM * MM)
    .lineTo((w / 2) * MM, (h - BAND_MM) * MM)
    .stroke()
    .undash()
    .restore();
}

function drawCentre(doc) {
  const { widthMm: w } = SHEET;
  const left = 22;
  const width = w - 44;
  let y = 16;

  const line = (text, { size = 9, font = "Helvetica", gap = 4.2, colour = "#000000" } = {}) => {
    doc
      .font(font)
      .fontSize(size)
      .fillColor(colour)
      .text(text, left * MM, y * MM, { width: width * MM, lineBreak: true });
    y += gap + (doc.heightOfString(text, { width: width * MM }) / MM - 3.2);
  };

  line("Kudos borderless calibration", { size: 15, font: "Helvetica-Bold", gap: 6 });
  line("A5 landscape, 210 x 148 mm - the sheet one A6 card folds from.", {
    size: 8.5,
    colour: "#444444",
    gap: 7,
  });

  line("Print it exactly like this", { size: 10, font: "Helvetica-Bold", gap: 4.5 });
  line(
    "Paper size:  A5 BORDERLESS, LANDSCAPE - 210 wide x 148 tall. Not 148 x 210: a portrait " +
      "page size cannot match this sheet, and borderless then never engages. That is the single " +
      "most likely reason a previous attempt came back with a white border.",
    { size: 8.5, gap: 4.2 },
  );
  line('Scaling:  Actual size / 100%. Never "Fit" or "Shrink oversized pages".', { size: 8.5 });
  line("Media type:  whatever you use for cards.   Extension:  leave where it normally sits.", {
    size: 8.5,
    gap: 7,
  });

  line("Then read it, in this order", { size: 10, font: "Helvetica-Bold", gap: 4.5 });
  line(
    "1.  Is there ANY white paper outside the grey band, on any edge?  If yes, borderless did " +
      "not engage - fix the paper size above and print again. Nothing else on this sheet means " +
      "anything until the grey runs off all four edges.",
    { size: 8.5, gap: 4.2 },
  );
  line(
    "2.  At the middle of each edge, find the shallowest numbered step still visible. That edge " +
      "loses a little less than that number. Write all four below.",
    { size: 8.5, gap: 4.2 },
  );
  line(
    "3.  Do the full frames get cut on one side but not the other?  That is the sheet feeding " +
      "off-centre, and it is worth saying so - a single number cannot correct it.",
    { size: 8.5, gap: 7 },
  );

  // The readings, as four named blanks: the change this sheet exists for.
  const boxY = y;
  const boxH = 20;
  doc
    .save()
    .strokeColor("#000000")
    .lineWidth(0.25 * MM)
    .rect(left * MM, boxY * MM, width * MM, boxH * MM)
    .stroke()
    .restore();

  const cellW = width / 4;
  EDGES.forEach((edge, index) => {
    const x = left + index * cellW;
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor("#000000")
      .text(edge.toUpperCase(), x * MM, (boxY + 4) * MM, { width: cellW * MM, align: "center" });
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#666666")
      .text("________ mm", x * MM, (boxY + 11) * MM, { width: cellW * MM, align: "center" });
  });

  doc
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor("#000000")
    .text(
      "Is LEFT the same as RIGHT?   YES / NO        Is TOP the same as BOTTOM?   YES / NO",
      left * MM,
      (boxY + boxH + 3.5) * MM,
      { width: width * MM, align: "center" },
    );
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor("#444444")
    .text(
      "Send all four numbers back, not just one. If they differ, say so - that is the finding, " +
        "not a measuring error.",
      left * MM,
      (boxY + boxH + 9) * MM,
      { width: width * MM, align: "center" },
    );

  return boxY + boxH + 15;
}

function build(outPath) {
  const doc = new PDFDocument({
    size: [SHEET.widthMm * MM, SHEET.heightMm * MM],
    margin: 0,
    info: { Title: "Kudos borderless calibration - A5 landscape" },
  });
  const stream = createWriteStream(outPath);
  doc.pipe(stream);

  drawBand(doc);
  drawFrames(doc);
  for (const edge of EDGES) drawSteps(doc, edge);
  drawFold(doc);
  const bottomMm = drawCentre(doc);

  // The instructions are the only part of this sheet whose height depends on how
  // much text it carries. If an edit ever pushes them into the measurement area
  // they would cover the very steps the operator is being told to read, and the
  // sheet would look fine on screen. Refuse to write one instead.
  const limitMm = SHEET.heightMm - BAND_MM - 6;
  if (bottomMm > limitMm) {
    throw new Error(
      `The instructions reach ${bottomMm.toFixed(1)} mm down a ${SHEET.heightMm} mm sheet, ` +
        `past the ${limitMm.toFixed(1)} mm the measurement area leaves for them. Shorten them.`,
    );
  }

  doc.end();
  return new Promise((done, fail) => {
    stream.on("finish", () => done({ bottomMm, limitMm }));
    stream.on("error", fail);
  });
}

const out = resolve(process.argv[2] ?? "kudos-borderless-calibration.pdf");
const { bottomMm, limitMm } = await build(out);
console.log(
  `Wrote ${out} — ${SHEET.widthMm} x ${SHEET.heightMm} mm; ` +
    `instructions end at ${bottomMm.toFixed(1)} mm of ${limitMm.toFixed(1)} available.`,
);
