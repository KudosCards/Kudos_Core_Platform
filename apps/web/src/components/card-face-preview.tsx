"use client";

import { Stage, Layer, Rect, Text, Image as KonvaImage } from "react-konva";
import useImage from "use-image";
import type { DesignDocument, DesignElement } from "@kudos/shared-types";

// The card canvas is authored at 450×600 (see the editor's design-canvas). This
// renders the front page read-only at an arbitrary display width, scaling the
// whole stage so element coordinates stay correct.
const CANVAS_WIDTH = 450;
const CANVAS_HEIGHT = 600;
const TEXT_RIGHT_PADDING = 16;

function ImageNode({ element }: { element: Extract<DesignElement, { kind: "image" }> }) {
  const [image] = useImage(element.assetUrl, "anonymous");
  return (
    <KonvaImage
      image={image}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
    />
  );
}

/**
 * A non-interactive render of a design's front page — used to show a card
 * exactly as it'll print, including merged {name} text (pass a document that's
 * already been through applyMergeTokens). Client-only: Konva touches canvas
 * APIs, so callers import this with `dynamic(..., { ssr: false })`.
 */
export function CardFacePreview({
  document,
  width = 225,
}: {
  document: DesignDocument;
  width?: number;
}) {
  const scale = width / CANVAS_WIDTH;
  const front = document.pages.find((page) => page.name === "front") ?? document.pages[0];

  return (
    <Stage
      width={width}
      height={CANVAS_HEIGHT * scale}
      scaleX={scale}
      scaleY={scale}
      className="rounded-md border border-black/10 bg-white dark:border-white/10"
    >
      <Layer listening={false}>
        <Rect x={0} y={0} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="#ffffff" />
        {(front?.elements ?? []).map((element) => {
          if (element.kind === "text") {
            return (
              <Text
                key={element.id}
                text={element.text}
                x={element.x}
                y={element.y}
                width={Math.max(40, CANVAS_WIDTH - element.x - TEXT_RIGHT_PADDING)}
                wrap="word"
                lineHeight={1.3}
                fontFamily={element.fontFamily}
                fontSize={element.fontSize}
                fill={element.color}
              />
            );
          }
          if (element.kind === "image") {
            return <ImageNode key={element.id} element={element} />;
          }
          // QR placeholder — the real per-card code is minted at fulfilment; a
          // plain marked square keeps its position visible in previews.
          return (
            <Rect
              key={element.id}
              x={element.x}
              y={element.y}
              width={element.size}
              height={element.size}
              fill="#0000000d"
              stroke="#00000026"
              strokeWidth={1}
            />
          );
        })}
      </Layer>
    </Stage>
  );
}
