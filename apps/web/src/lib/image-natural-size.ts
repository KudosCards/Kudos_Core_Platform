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

/**
 * Read a chosen file's natural pixel size, before it is uploaded.
 *
 * Resolves `null` when the file cannot be decoded, and that is the whole
 * difference from the editor's `readImageSize`, which falls back to a square so
 * an insert still gets a sensible box. A square fallback is fine for sizing and
 * wrong for a gate: it would be judged as heavily cropped and the upload refused
 * because we failed to read it. Unmeasurable must mean "say nothing" here — the
 * server gate fails open for the same reason.
 */
export function readFileNaturalSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new window.Image();
    const done = (size: { width: number; height: number } | null) => {
      URL.revokeObjectURL(objectUrl);
      resolve(size);
    };
    img.onload = () =>
      done(
        img.naturalWidth && img.naturalHeight
          ? { width: img.naturalWidth, height: img.naturalHeight }
          : null,
      );
    img.onerror = () => done(null);
    img.src = objectUrl;
  });
}
