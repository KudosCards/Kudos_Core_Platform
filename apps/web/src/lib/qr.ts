import QRCode from "qrcode";

/**
 * Renders a QR code for `text` as a PNG data URL. Used both in the card designer
 * (a placeholder preview) and on the Messages page (each recipient's real
 * /r/<slug> link). Client-side only — `qrcode` draws to a canvas.
 */
export function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 512,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
