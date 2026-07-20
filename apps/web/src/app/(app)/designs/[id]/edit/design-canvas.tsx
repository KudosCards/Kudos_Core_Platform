"use client";

import { useEffect, useState } from "react";
import { Stage, Layer, Text, Rect, Image as KonvaImage } from "react-konva";
import useImage from "use-image";
import type { DesignElement, DesignPage } from "@kudos/shared-types";
import { qrDataUrl } from "@/lib/qr";

export const CANVAS_WIDTH = 450;
export const CANVAS_HEIGHT = 600;

/** Renders a placeholder QR in the editor. The real per-recipient link is
 * substituted at send time, so here we just encode a sample /r/ URL to show
 * what it will look like and where it sits. */
function QrNode({
  element,
  isSelected,
  onSelect,
  onDragEnd,
}: {
  element: Extract<DesignElement, { kind: "qr" }>;
  isSelected: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
}) {
  const [dataUrl, setDataUrl] = useState<string>("");
  useEffect(() => {
    let active = true;
    const sampleUrl =
      typeof window !== "undefined" ? `${window.location.origin}/r/preview` : "https://kudos/r/preview";
    void qrDataUrl(sampleUrl).then((url) => {
      if (active) setDataUrl(url);
    });
    return () => {
      active = false;
    };
  }, []);
  const [image] = useImage(dataUrl);
  return (
    <KonvaImage
      image={image}
      x={element.x}
      y={element.y}
      width={element.size}
      height={element.size}
      rotation={element.rotation}
      draggable
      stroke={isSelected ? "#2563eb" : "#00000022"}
      strokeWidth={isSelected ? 2 : 1}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
    />
  );
}

function ImageNode({
  element,
  isSelected,
  onSelect,
  onDragEnd,
}: {
  element: Extract<DesignElement, { kind: "image" }>;
  isSelected: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
}) {
  const [image] = useImage(element.assetUrl, "anonymous");
  return (
    <KonvaImage
      image={image}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      draggable
      stroke={isSelected ? "#2563eb" : undefined}
      strokeWidth={isSelected ? 2 : 0}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
    />
  );
}

/**
 * Client-only (dynamically imported with ssr: false — Konva touches the
 * canvas/window APIs and can't render on the server). No resize/rotate
 * handles (a Konva Transformer) in this pass — width/height/rotation are
 * edited via the side panel's numeric inputs instead. See
 * docs/adr/0006-phase-2-scope.md for the Konva-vs-Fabric tradeoff this
 * follows from.
 */
export function DesignCanvas({
  page,
  selectedElementId,
  onSelect,
  onElementChange,
  onDeselect,
}: {
  page: DesignPage;
  selectedElementId: string | null;
  onSelect: (id: string) => void;
  onElementChange: (element: DesignElement) => void;
  onDeselect: () => void;
}) {
  return (
    <Stage
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      onMouseDown={(e) => {
        if (e.target === e.target.getStage()) {
          onDeselect();
        }
      }}
      className="rounded-md border border-black/10 bg-white dark:border-white/10"
    >
      <Layer>
        <Rect x={0} y={0} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="#ffffff" />
        {page.elements.map((element) => {
          const isSelected = element.id === selectedElementId;
          if (element.kind === "text") {
            return (
              <Text
                key={element.id}
                text={element.text}
                x={element.x}
                y={element.y}
                fontFamily={element.fontFamily}
                fontSize={element.fontSize}
                fill={element.color}
                draggable
                stroke={isSelected ? "#2563eb" : undefined}
                strokeWidth={isSelected ? 0.5 : 0}
                onClick={() => onSelect(element.id)}
                onTap={() => onSelect(element.id)}
                onDragEnd={(e) => onElementChange({ ...element, x: e.target.x(), y: e.target.y() })}
              />
            );
          }
          if (element.kind === "qr") {
            return (
              <QrNode
                key={element.id}
                element={element}
                isSelected={isSelected}
                onSelect={() => onSelect(element.id)}
                onDragEnd={(x, y) => onElementChange({ ...element, x, y })}
              />
            );
          }
          return (
            <ImageNode
              key={element.id}
              element={element}
              isSelected={isSelected}
              onSelect={() => onSelect(element.id)}
              onDragEnd={(x, y) => onElementChange({ ...element, x, y })}
            />
          );
        })}
      </Layer>
    </Stage>
  );
}
