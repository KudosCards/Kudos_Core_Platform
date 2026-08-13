/**
 * QR drawing for the card→PDF renderer (docs/adr/0162).
 *
 * The card's QR resolves to the recipient's digital message page (/r/<slug>).
 * The web preview rasterises a 512px PNG (lib/qr.ts); for print we draw the QR
 * as *vector* modules — infinitely crisp, tiny, and byte-for-byte the same code
 * because we use the same `qrcode` library and options (error-correction "M", a
 * 1-module quiet zone). Without a URL (shouldn't happen at print time) a marked
 * placeholder square is drawn, matching the designer preview.
 *
 * Drawn in local box coordinates [0..size] × [0..size]; the renderer has already
 * translated to the element's x/y and applied rotation.
 */

import QRCode from "qrcode";

/** Quiet-zone width in modules — matches lib/qr.ts (`margin: 1`). */
const QUIET_ZONE = 1;

/** Draw a real scannable QR for `url` filling a `size`×`size` box (design units). */
export function drawQr(doc: PDFKit.PDFDocument, size: number, url: string): void {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const data = qr.modules.data;
  const grid = count + QUIET_ZONE * 2;
  const module = size / grid;

  // White background across the whole box (includes the quiet zone).
  doc.save();
  doc.rect(0, 0, size, size).fill("#ffffff");

  // Dark modules as black squares. Draw each 0.5% larger than the grid pitch so
  // abutting modules never leave a sub-pixel seam when rasterised by a RIP.
  const overlap = module * 0.02;
  doc.fillColor("#000000");
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (data[row * count + col]) {
        const x = (QUIET_ZONE + col) * module;
        const y = (QUIET_ZONE + row) * module;
        doc.rect(x, y, module + overlap, module + overlap);
      }
    }
  }
  doc.fill();
  doc.restore();
}

/** Draw the QR placeholder square used when no URL is available (mirrors the
 * designer preview in card-face-preview.tsx). */
export function drawQrPlaceholder(doc: PDFKit.PDFDocument, size: number): void {
  doc.save();
  doc.rect(0, 0, size, size);
  doc.fillColor("#000000", 0.05);
  doc.fill();
  doc.rect(0, 0, size, size);
  doc.strokeColor("#000000", 0.15);
  doc.lineWidth(1);
  doc.stroke();
  doc.restore();
}
