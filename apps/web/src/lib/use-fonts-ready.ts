"use client";

import { useEffect, useState } from "react";

/**
 * Returns a value that flips once web fonts have finished loading, and again on
 * any later font-loading batch. A Konva renderer uses it as a dependency so it
 * re-renders (and thus redraws) after a font arrives — canvas text otherwise
 * paints with the fallback and never updates itself. SSR-safe (starts at 0).
 */
export function useFontsReady(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) return;
    let cancelled = false;
    const bump = () => {
      if (!cancelled) setTick((t) => t + 1);
    };
    void fonts.ready.then(bump);
    // Later batches (e.g. a weight/style requested after first paint) also redraw.
    fonts.addEventListener("loadingdone", bump);
    return () => {
      cancelled = true;
      fonts.removeEventListener("loadingdone", bump);
    };
  }, []);
  return tick;
}
