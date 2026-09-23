"use client";

import dynamic from "next/dynamic";
import { useLayoutEffect, useRef, useState } from "react";
import type { DesignDocument } from "@kudos/shared-types";

const CardFacePreview = dynamic(
  () => import("@/components/card-face-preview").then((m) => m.CardFacePreview),
  { ssr: false },
);

/**
 * A saved design has no flat thumbnail image (unlike a catalog template) — only
 * its editable document — so showing one means rendering that document. This
 * measures its own width and hands it to CardFacePreview, which scales the
 * 450×634 card to fit crisply (mirroring the editor canvas's own responsive
 * scaling).
 *
 * Shared by the design library and the click-and-forget pool, because a card a
 * subscriber is choosing between should look the same in both places — and
 * because two copies of a canvas-measuring effect is one more than anybody
 * wants to debug.
 */
export function SavedDesignThumb({ document }: { document: DesignDocument }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="w-full">
      {width > 0 && <CardFacePreview document={document} width={width} />}
    </div>
  );
}
