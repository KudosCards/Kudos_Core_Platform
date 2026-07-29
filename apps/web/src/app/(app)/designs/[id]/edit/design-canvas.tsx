"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Stage, Layer, Text, Rect, Image as KonvaImage } from "react-konva";
import useImage from "use-image";
import type { DesignElement, DesignPage } from "@kudos/shared-types";
import {
  CARD_HEIGHT,
  CARD_SAFE_MARGIN,
  CARD_WIDTH,
  clampElementPosition,
  isOutsideSafeArea,
  textWrapWidth,
} from "@kudos/shared-types";
import { qrDataUrl } from "@/lib/qr";

// Kept as named exports for stability; the card geometry itself now lives in
// shared-types so the editor, previews, and any server render stay in lockstep.
export const CANVAS_WIDTH = CARD_WIDTH;
export const CANVAS_HEIGHT = CARD_HEIGHT;

// On a wide screen the card is authored at 450px but there's plenty of room to
// work bigger, so let the Stage scale up (Konva re-renders text/shapes crisply
// at any scale). Capped so the card never dominates the viewport; the container
// max-width below is kept in step (450 × 1.42 ≈ 640px). See #12 (widescreen).
const MAX_CANVAS_SCALE = 1.42;

/** Clamp a Konva drag to keep the element on the card. `scale` converts between
 * the on-screen (scaled) coordinates dragBoundFunc works in and the 450×600
 * design space the guard rail is defined in. */
function makeDragBound(
  scale: number,
  size: { width?: number; height?: number },
): (pos: Konva.Vector2d) => Konva.Vector2d {
  return (pos) => {
    const clamped = clampElementPosition({ x: pos.x / scale, y: pos.y / scale }, size);
    return { x: clamped.x * scale, y: clamped.y * scale };
  };
}

/** Renders a placeholder QR in the editor. The real per-recipient link is
 * substituted at send time, so here we just encode a sample /r/ URL to show
 * what it will look like and where it sits. */
function QrNode({
  element,
  isSelected,
  scale,
  onSelect,
  onDragEnd,
}: {
  element: Extract<DesignElement, { kind: "qr" }>;
  isSelected: boolean;
  scale: number;
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
      dragBoundFunc={makeDragBound(scale, { width: element.size, height: element.size })}
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
  scale,
  onSelect,
  onDragEnd,
}: {
  element: Extract<DesignElement, { kind: "image" }>;
  isSelected: boolean;
  scale: number;
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
      dragBoundFunc={makeDragBound(scale, { width: element.width, height: element.height })}
      stroke={isSelected ? "#2563eb" : undefined}
      strokeWidth={isSelected ? 2 : 0}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
    />
  );
}

/**
 * A text element plus its guard rails: it word-wraps within its box (an
 * explicit `width`, or the card edge), and while selected shows a dashed
 * bounding box that turns red — and reports overflow up — when the text strays
 * outside the printer safe area. The box height is measured from the rendered
 * Konva node after layout.
 */
function TextNode({
  element,
  isSelected,
  scale,
  onSelect,
  onDragEnd,
  onOverflowChange,
}: {
  element: Extract<DesignElement, { kind: "text" }>;
  isSelected: boolean;
  scale: number;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
  onOverflowChange: (overflowing: boolean) => void;
}) {
  const textRef = useRef<Konva.Text>(null);
  const [height, setHeight] = useState(0);
  const width = textWrapWidth(element);

  // Measure the rendered height after every layout-affecting change so the
  // bounding box and overflow check track the real text extent.
  useLayoutEffect(() => {
    const node = textRef.current;
    if (node) setHeight(node.height());
  }, [element.text, element.fontFamily, element.fontSize, element.width, width]);

  const overflowing = height > 0 && isOutsideSafeArea({ x: element.x, y: element.y, width, height });

  // Report overflow only while this element is the selected one (the panel warns
  // about the selection). A layout effect keeps it in sync without a render loop.
  useLayoutEffect(() => {
    if (isSelected) onOverflowChange(overflowing);
  }, [isSelected, overflowing, onOverflowChange]);

  return (
    <>
      {isSelected && height > 0 && (
        <Rect
          x={element.x}
          y={element.y}
          width={width}
          height={height}
          listening={false}
          stroke={overflowing ? "#dc2626" : "#2563eb"}
          strokeWidth={1}
          dash={[6, 4]}
        />
      )}
      <Text
        ref={textRef}
        text={element.text}
        x={element.x}
        y={element.y}
        // Bound the text to its box so multi-line / pasted text WORD-WRAPS
        // instead of running off the edge. Explicit "\n" breaks are honoured.
        width={width}
        align={element.align ?? "left"}
        wrap="word"
        lineHeight={1.3}
        fontFamily={element.fontFamily}
        fontSize={element.fontSize}
        fill={element.color}
        draggable
        dragBoundFunc={makeDragBound(scale, { width, height: height || undefined })}
        stroke={isSelected ? "#2563eb" : undefined}
        strokeWidth={isSelected ? 0.5 : 0}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
      />
    </>
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
  onSelectedOverflowChange,
}: {
  page: DesignPage;
  selectedElementId: string | null;
  onSelect: (id: string) => void;
  onElementChange: (element: DesignElement) => void;
  onDeselect: () => void;
  /** Fires with whether the selected text element overflows the safe area, so
   * the editor panel can warn. */
  onSelectedOverflowChange?: (overflowing: boolean) => void;
}) {
  // The card is authored at a fixed 450×600, but on a phone that's wider than
  // the viewport. Scale the whole Stage down to fit the container so the entire
  // card is visible and elements can be dragged in place — element coordinates
  // stay in the 450×600 design space (drag reports layer coords, unaffected by
  // Stage scale), so nothing downstream changes.
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () =>
      setScale(Math.min(MAX_CANVAS_SCALE, el.clientWidth / CANVAS_WIDTH));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const reportOverflow = onSelectedOverflowChange ?? (() => {});

  return (
    <div ref={containerRef} className="w-full max-w-[640px] overflow-hidden">
      <Stage
        width={CANVAS_WIDTH * scale}
        height={CANVAS_HEIGHT * scale}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={(e) => {
          if (e.target === e.target.getStage()) {
            onDeselect();
          }
        }}
        // touch-none lets Konva own touch gestures on the canvas (reliable
        // element dragging) instead of the browser scrolling/zooming the page.
        className="touch-none rounded-md border border-black/10 bg-white dark:border-white/10"
      >
        <Layer>
          <Rect
            x={0}
            y={0}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            fill="#ffffff"
            // The background fills the canvas, so a tap on "empty" space lands
            // here, not the Stage — deselect from here too (works on touch).
            onMouseDown={onDeselect}
            onTap={onDeselect}
          />
          {/* Printer safe-area guide: keep content inside this dashed frame so
              nothing important is lost to bleed/trim. Non-interactive. */}
          <Rect
            x={CARD_SAFE_MARGIN}
            y={CARD_SAFE_MARGIN}
            width={CANVAS_WIDTH - CARD_SAFE_MARGIN * 2}
            height={CANVAS_HEIGHT - CARD_SAFE_MARGIN * 2}
            listening={false}
            stroke="#94a3b8"
            strokeWidth={1}
            dash={[4, 4]}
          />
          {page.elements.map((element) => {
            const isSelected = element.id === selectedElementId;
            if (element.kind === "text") {
              return (
                <TextNode
                  key={element.id}
                  element={element}
                  isSelected={isSelected}
                  scale={scale}
                  onSelect={() => onSelect(element.id)}
                  onDragEnd={(x, y) => onElementChange({ ...element, x, y })}
                  onOverflowChange={reportOverflow}
                />
              );
            }
            if (element.kind === "qr") {
              return (
                <QrNode
                  key={element.id}
                  element={element}
                  isSelected={isSelected}
                  scale={scale}
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
                scale={scale}
                onSelect={() => onSelect(element.id)}
                onDragEnd={(x, y) => onElementChange({ ...element, x, y })}
              />
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
