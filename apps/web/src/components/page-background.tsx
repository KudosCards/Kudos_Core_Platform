"use client";

import { Rect, Image as KonvaImage } from "react-konva";
import useImage from "use-image";
import type { PageBackground as PageBackgroundValue } from "@kudos/shared-types";
import { CARD_HEIGHT, CARD_WIDTH, coverCrop } from "@kudos/shared-types";

/**
 * A page's background fill, drawn behind its elements. Shared by the editor
 * canvas and the read-only preview so a card looks the same everywhere. Solid
 * colour or a cover-cropped image; nothing when the page has no background (the
 * white base Rect the renderers already draw shows through). Non-interactive, so
 * a click on the background still lands on the base Rect (deselect).
 */
export function PageBackground({ background }: { background?: PageBackgroundValue }) {
  // Hook must run unconditionally; empty src yields no image (a no-op for colour
  // / no background).
  const src = background?.type === "image" ? background.assetUrl : "";
  const [image] = useImage(src, "anonymous");

  if (!background) return null;

  if (background.type === "color") {
    return (
      <Rect
        x={0}
        y={0}
        width={CARD_WIDTH}
        height={CARD_HEIGHT}
        fill={background.color}
        listening={false}
      />
    );
  }

  if (!image) return null;
  const crop = coverCrop(
    { width: image.width, height: image.height },
    { width: CARD_WIDTH, height: CARD_HEIGHT },
  );
  return (
    <KonvaImage
      x={0}
      y={0}
      width={CARD_WIDTH}
      height={CARD_HEIGHT}
      image={image}
      crop={crop}
      listening={false}
    />
  );
}
