/**
 * Vector shape drawing for the card→PDF renderer (docs/adr/0162), reproducing
 * `card-shape.tsx` primitive-for-primitive so a shape prints exactly as authored.
 *
 * Shapes are drawn in local box coordinates [0..w] × [0..h]; the renderer has
 * already translated to the element's x/y and applied its rotation (matching the
 * editor's `<Group x y rotation>` wrapper). Fill/stroke follow Konva: a stored
 * `strokeWidth` of 0 (the panel's default when no stroke is set) means no stroke,
 * never Konva's implicit 2px.
 */

import type { DesignElement } from "@kudos/shared-types";
import { parseColor } from "./color";

/** The Material "favorite" heart path in a 24×24 box — identical to card-shape.tsx. */
const HEART_PATH =
  "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";
const HEART_VIEWBOX = 24;

type ShapeElement = Extract<DesignElement, { kind: "shape" }>;

/**
 * Paint the current path with the shape's fill/stroke. Both, either, or neither
 * (an unfilled, unstroked box is invisible in Konva — we just discard the path).
 */
function paint(
  doc: PDFKit.PDFDocument,
  fill?: string,
  stroke?: string,
  strokeWidth?: number,
): void {
  const hasFill = typeof fill === "string" && fill.length > 0;
  const width = strokeWidth ?? 0;
  const hasStroke = typeof stroke === "string" && stroke.length > 0 && width > 0;

  if (hasFill) {
    const f = parseColor(fill);
    doc.fillColor(f.color, f.opacity);
  }
  if (hasStroke) {
    const s = parseColor(stroke);
    doc.strokeColor(s.color, s.opacity);
    doc.lineWidth(width);
  }

  if (hasFill && hasStroke) doc.fillAndStroke();
  else if (hasFill) doc.fill();
  else if (hasStroke) doc.stroke();
  else doc.fillColor("#000000", 0).fill(); // consume the path invisibly
}

/** Draw a shape element in its local box coordinates. */
export function drawShape(doc: PDFKit.PDFDocument, element: ShapeElement): void {
  const { width: w, height: h, fill, stroke, strokeWidth, cornerRadius, shape } = element;

  switch (shape) {
    case "rect":
      if (cornerRadius && cornerRadius > 0) doc.roundedRect(0, 0, w, h, cornerRadius);
      else doc.rect(0, 0, w, h);
      paint(doc, fill, stroke, strokeWidth);
      break;

    case "ellipse":
      // pdfkit ellipse takes the centre and the two radii.
      doc.ellipse(w / 2, h / 2, w / 2, h / 2);
      paint(doc, fill, stroke, strokeWidth);
      break;

    case "triangle":
      doc
        .moveTo(w / 2, 0)
        .lineTo(w, h)
        .lineTo(0, h)
        .closePath();
      paint(doc, fill, stroke, strokeWidth);
      break;

    case "star": {
      const outer = Math.min(w, h) / 2;
      const inner = outer * 0.5;
      const cx = w / 2;
      const cy = h / 2;
      const numPoints = 5;
      // Konva Star: first point at the top (outer radius), then alternate
      // outer/inner around the circle.
      doc.moveTo(cx, cy - outer);
      for (let n = 1; n < numPoints * 2; n++) {
        const radius = n % 2 === 0 ? outer : inner;
        const angle = (n * Math.PI) / numPoints;
        doc.lineTo(cx + radius * Math.sin(angle), cy - radius * Math.cos(angle));
      }
      doc.closePath();
      paint(doc, fill, stroke, strokeWidth);
      break;
    }

    case "heart":
      // Konva scales the Path node (stroke scales with it — strokeScaleEnabled).
      doc.save();
      doc.scale(w / HEART_VIEWBOX, h / HEART_VIEWBOX);
      doc.path(HEART_PATH);
      paint(doc, fill, stroke, strokeWidth);
      doc.restore();
      break;

    case "line": {
      // A horizontal rule across the box; stroke-only with card-shape's defaults.
      const s = parseColor(stroke ?? "#111111");
      doc.strokeColor(s.color, s.opacity);
      doc.lineWidth(strokeWidth ?? 4);
      doc.lineCap("round");
      doc
        .moveTo(0, h / 2)
        .lineTo(w, h / 2)
        .stroke();
      break;
    }
  }
}
