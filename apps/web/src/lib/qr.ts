/**
 * Renders a QR code for `text` as a PNG data URL. Used both in the card designer
 * (a placeholder preview) and on the Messages page (each recipient's real
 * /r/<slug> link). Client-side only — `qrcode` draws to a canvas.
 *
 * The `qrcode` library (~50 kB) is imported lazily inside this async function so
 * it never lands in a page's first-load bundle — it's fetched on demand the
 * first time a QR is actually rendered. Callers already await this, so the lazy
 * import is transparent.
 */
export async function qrDataUrl(text: string): Promise<string> {
  const { default: QRCode } = await import("qrcode");
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 512,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
