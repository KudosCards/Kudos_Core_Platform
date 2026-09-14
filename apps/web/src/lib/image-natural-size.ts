/**
 * Read an image's natural pixel size in the browser.
 *
 * Two pre-flights need this and they are different questions — "are there
 * enough pixels" (`imagePrintDpi`) and "is the shape right" (`coverCropLoss`) —
 * but the measurement they need is the same one, so it lives in one place
 * rather than once in the ops print overlay and again in the design editor.
 *
 * Resolves `null` rather than rejecting when the image cannot be loaded: a load
 * failure must not produce a warning about artwork we never measured.
 */
export function loadNaturalSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    // No crossOrigin: we only read naturalWidth/Height, which needs no CORS, and
    // requesting it makes assets served without CORS headers fail to load —
    // which would silently suppress the warning we are here to raise.
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
