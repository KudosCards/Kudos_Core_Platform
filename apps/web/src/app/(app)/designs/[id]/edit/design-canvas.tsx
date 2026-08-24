"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Stage, Layer, Text, Rect, Line, Group, Image as KonvaImage, Transformer } from "react-konva";
import useImage from "use-image";
import type { DesignElement, DesignPage, SnapLine } from "@kudos/shared-types";
import {
  BACK_RESERVED_FOOTER_MM,
  backReservedFooterTop,
  bakeScale,
  isInBackReservedFooter,
  CARD_HEIGHT,
  CARD_SAFE_MARGIN,
  CARD_WIDTH,
  cardSnapLines,
  clampElementPosition,
  computeSnap,
  isOutsideSafeArea,
  konvaFontStyle,
  konvaTextDecoration,
  MIN_ELEMENT_SIZE,
  MIN_FONT_SIZE,
  normaliseRotation,
  steppedZoom,
  textWrapWidth,
  ZOOM_MAX,
  ZOOM_MIN,
} from "@kudos/shared-types";
import { qrDataUrl } from "@/lib/qr";
import { resolveFontFamily } from "@/lib/editor-fonts";
import { useFontsReady } from "@/lib/use-fonts-ready";
import { PageBackground } from "@/components/page-background";
import { ShapePrimitive } from "@/components/card-shape";

// Kept as named exports for stability; the card geometry itself now lives in
// shared-types so the editor, previews, and any server render stay in lockstep.
export const CANVAS_WIDTH = CARD_WIDTH;
export const CANVAS_HEIGHT = CARD_HEIGHT;

// On a wide screen the card is authored at 450px but there's plenty of room to
// work bigger, so let the Stage scale up (Konva re-renders text/shapes crisply
// at any scale). Capped so the card never dominates the viewport; the container
// max-width below is kept in step (450 × 1.42 ≈ 640px). See #12 (widescreen).
const MAX_CANVAS_SCALE = 1.42;

const CORNER_ANCHORS = ["top-left", "top-right", "bottom-left", "bottom-right"];

/** Live drag-snapping wiring shared by every node: `onStart` gathers the snap
 * targets, `onMove` snaps the node + shows guides, `onEnd` clears the guides.
 * The node still commits its own x/y in its own `onDragEnd`. */
interface DragBridge {
  onStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onEnd: () => void;
}

/** Clamp a Konva drag to keep the element on the card. `scale` converts between
 * the on-screen (scaled) coordinates dragBoundFunc works in and the 450×634
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
  scale,
  drag,
  onSelect,
  onChange,
}: {
  element: Extract<DesignElement, { kind: "qr" }>;
  scale: number;
  drag: DragBridge;
  onSelect: () => void;
  onChange: (element: DesignElement) => void;
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
      id={element.id}
      name="element"
      image={image}
      x={element.x}
      y={element.y}
      width={element.size}
      height={element.size}
      rotation={element.rotation}
      draggable
      dragBoundFunc={makeDragBound(scale, { width: element.size, height: element.size })}
      onClick={onSelect}
      onTap={onSelect}
      onDragStart={drag.onStart}
      onDragMove={drag.onMove}
      onDragEnd={(e) => {
        drag.onEnd();
        onChange({ ...element, x: e.target.x(), y: e.target.y() });
      }}
      onTransformEnd={(e) => {
        const node = e.target;
        const s = node.scaleX();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          ...element,
          x: node.x(),
          y: node.y(),
          size: bakeScale(element.size, s),
          rotation: normaliseRotation(node.rotation()),
        });
      }}
    />
  );
}

function ImageNode({
  element,
  scale,
  drag,
  onSelect,
  onChange,
}: {
  element: Extract<DesignElement, { kind: "image" }>;
  scale: number;
  drag: DragBridge;
  onSelect: () => void;
  onChange: (element: DesignElement) => void;
}) {
  const [image] = useImage(element.assetUrl, "anonymous");
  return (
    <KonvaImage
      id={element.id}
      name="element"
      image={image}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      draggable
      dragBoundFunc={makeDragBound(scale, { width: element.width, height: element.height })}
      onClick={onSelect}
      onTap={onSelect}
      onDragStart={drag.onStart}
      onDragMove={drag.onMove}
      onDragEnd={(e) => {
        drag.onEnd();
        onChange({ ...element, x: e.target.x(), y: e.target.y() });
      }}
      onTransformEnd={(e) => {
        const node = e.target;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          ...element,
          x: node.x(),
          y: node.y(),
          width: bakeScale(element.width, scaleX),
          height: bakeScale(element.height, scaleY),
          rotation: normaliseRotation(node.rotation()),
        });
      }}
    />
  );
}

/** A native vector shape drawn in a Group at the element's box. The Group is the
 * draggable / transformable node; a resize bakes into width/height (like an
 * image), so the shape stays crisp. */
function ShapeNode({
  element,
  scale,
  drag,
  onSelect,
  onChange,
}: {
  element: Extract<DesignElement, { kind: "shape" }>;
  scale: number;
  drag: DragBridge;
  onSelect: () => void;
  onChange: (element: DesignElement) => void;
}) {
  return (
    <Group
      id={element.id}
      name="element"
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      draggable
      dragBoundFunc={makeDragBound(scale, { width: element.width, height: element.height })}
      onClick={onSelect}
      onTap={onSelect}
      onDragStart={drag.onStart}
      onDragMove={drag.onMove}
      onDragEnd={(e) => {
        drag.onEnd();
        onChange({ ...element, x: e.target.x(), y: e.target.y() });
      }}
      onTransformEnd={(e) => {
        const node = e.target;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          ...element,
          x: node.x(),
          y: node.y(),
          width: bakeScale(element.width, scaleX),
          height: bakeScale(element.height, scaleY),
          rotation: normaliseRotation(node.rotation()),
        });
      }}
    >
      <ShapePrimitive element={element} />
    </Group>
  );
}

/**
 * A text element plus its guard rails: it word-wraps within its box (an
 * explicit `width`, or the card edge), and while selected reports overflow up —
 * showing a red dashed box — when the text strays outside the printer safe
 * area. Resizing via the Transformer scales the font + box together
 * (`keepRatio`), and rotation is honoured.
 */
function TextNode({
  element,
  isSelected,
  scale,
  drag,
  fontsTick,
  onSelect,
  onChange,
  onOverflowChange,
}: {
  element: Extract<DesignElement, { kind: "text" }>;
  isSelected: boolean;
  scale: number;
  drag: DragBridge;
  /** Bumps when web fonts finish loading, so height re-measures once the real
   * font (not the fallback) is in use. */
  fontsTick: number;
  onSelect: () => void;
  onChange: (element: DesignElement) => void;
  onOverflowChange: (overflowing: boolean) => void;
}) {
  const textRef = useRef<Konva.Text>(null);
  const [height, setHeight] = useState(0);
  const width = textWrapWidth(element);

  // Measure the rendered height after every layout-affecting change so the
  // bounding box and overflow check track the real text extent (fontsTick so it
  // re-measures once the chosen web font has actually loaded).
  useLayoutEffect(() => {
    const node = textRef.current;
    if (node) setHeight(node.height());
  }, [
    element.text,
    element.fontFamily,
    element.fontSize,
    element.width,
    element.bold,
    element.italic,
    width,
    fontsTick,
  ]);

  const overflowing = height > 0 && isOutsideSafeArea({ x: element.x, y: element.y, width, height });

  // Report overflow only while this element is the selected one (the panel warns
  // about the selection). A layout effect keeps it in sync without a render loop.
  useLayoutEffect(() => {
    if (isSelected) onOverflowChange(overflowing);
  }, [isSelected, overflowing, onOverflowChange]);

  return (
    <>
      {/* Only draw a box for the overflow warning now — the Transformer shows
          the selection outline + handles, so a second blue box is redundant. */}
      {isSelected && overflowing && height > 0 && (
        <Rect
          x={element.x}
          y={element.y}
          width={width}
          height={height}
          rotation={element.rotation}
          listening={false}
          stroke="#dc2626"
          strokeWidth={1}
          dash={[6, 4]}
        />
      )}
      <Text
        id={element.id}
        name="element"
        ref={textRef}
        text={element.text}
        x={element.x}
        y={element.y}
        rotation={element.rotation}
        // Bound the text to its box so multi-line / pasted text WORD-WRAPS
        // instead of running off the edge. Explicit "\n" breaks are honoured.
        width={width}
        align={element.align ?? "left"}
        wrap="word"
        lineHeight={1.3}
        fontFamily={resolveFontFamily(element.fontFamily)}
        fontSize={element.fontSize}
        fontStyle={konvaFontStyle(element.bold, element.italic)}
        textDecoration={konvaTextDecoration(element.underline)}
        fill={element.color}
        draggable
        dragBoundFunc={makeDragBound(scale, { width, height: height || undefined })}
        onClick={onSelect}
        onTap={onSelect}
        onDragStart={drag.onStart}
        onDragMove={drag.onMove}
        onDragEnd={(e) => {
          drag.onEnd();
          onChange({ ...element, x: e.target.x(), y: e.target.y() });
        }}
        onTransformEnd={(e) => {
          // Uniform scale (the Transformer is keepRatio for text): fold it into
          // the font size + wrap width so the text stays crisp instead of a
          // stretched bitmap, and reset the node scale to 1.
          const node = e.target;
          const s = node.scaleX();
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            ...element,
            x: node.x(),
            y: node.y(),
            fontSize: bakeScale(element.fontSize, s, MIN_FONT_SIZE),
            width: bakeScale(element.width ?? width, s, 40),
            rotation: normaliseRotation(node.rotation()),
          });
        }}
      />
    </>
  );
}

/**
 * Client-only (dynamically imported with ssr: false — Konva touches the
 * canvas/window APIs and can't render on the server). Direct manipulation: a
 * Konva Transformer gives corner scale handles + a rotate handle on the
 * selected element (Moonpig-style), on top of dragging, and dragging snaps to
 * alignment guides (card centre / safe margins / other elements — hold Alt to
 * bypass). Numeric inputs in the side panel remain as an accessible
 * alternative. See ADR 0083 (handles) and 0084 (snapping).
 */
export function DesignCanvas({
  page,
  selectedElementId,
  lockImageAspect,
  onSelect,
  onElementChange,
  onDeselect,
  onSelectedOverflowChange,
  onReservedFooterOverlapChange,
}: {
  page: DesignPage;
  selectedElementId: string | null;
  /** Whether image resize keeps the photo's aspect ratio (mirrors the panel). */
  lockImageAspect: boolean;
  onSelect: (id: string) => void;
  onElementChange: (element: DesignElement) => void;
  onDeselect: () => void;
  /** Fires with whether the selected text element overflows the safe area, so
   * the editor panel can warn. */
  onSelectedOverflowChange?: (overflowing: boolean) => void;
  /** Fires with whether *anything* on this face reaches into the back's reserved
   * footer, so the editor can warn once for the whole face rather than only for
   * the current selection — a back filled with a grid of adverts is the case
   * this exists for, and every tile in it is equally wrong. */
  onReservedFooterOverlapChange?: (overlapping: boolean) => void;
}) {
  // The card is authored at a fixed 450×634, but on a phone that's wider than
  // the viewport. Scale the whole Stage down to fit the container so the entire
  // card is visible and elements can be dragged in place — element coordinates
  // stay in the 450×634 design space (drag reports layer coords, unaffected by
  // Stage scale), so nothing downstream changes.
  const containerRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () =>
      setFitScale(Math.min(MAX_CANVAS_SCALE, el.clientWidth / CANVAS_WIDTH));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // User zoom on top of the fit-to-width scale: 1 = fitted (the whole card
  // visible), >1 zooms in for fine placement (the canvas box then scrolls). The
  // effective Stage scale is the product, so every coordinate conversion
  // (drag/snap/transform, which already use `scale`) tracks zoom automatically.
  const [zoom, setZoom] = useState(1);
  const scale = fitScale * zoom;

  // On a touch screen (coarse pointer) the Transformer's resize/rotate handles
  // need to be finger-sized, not the tight 10px they are for a mouse — otherwise
  // they're almost impossible to grab. Tracked reactively so a 2-in-1 device that
  // switches input mode updates live.
  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarsePointer(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const reportOverflow = onSelectedOverflowChange ?? (() => {});

  // The bottom strip of the back is pre-printed on our card stock (Kudos logo +
  // QR), so it is not the customer's to design on — see card-format.ts
  // BACK_RESERVED_FOOTER_MM. Null on every other face, which is entirely theirs.
  //
  // Deliberately the default (A6) size: ops picks the trim per print run, so the
  // editor can't know it, and the A6 band is the taller of the two in design
  // units (128.5 vs 90.6) — so guiding against A6 is safe for a design that ends
  // up printed at A5, never the other way round.
  const reservedTop = page.name === "back" ? backReservedFooterTop() : null;

  // Bumps when web fonts finish loading; used to re-measure text and redraw the
  // canvas so a chosen font paints for real instead of the fallback.
  const fontsTick = useFontsReady();

  // Attach the Transformer to whichever node is selected. Re-run when the
  // selection changes or the elements change (e.g. after undo/redo), so it
  // never points at a stale or removed node.
  const layerRef = useRef<Konva.Layer>(null);
  const trRef = useRef<Konva.Transformer>(null);
  useEffect(() => {
    const tr = trRef.current;
    const layer = layerRef.current;
    if (!tr || !layer) return;
    const node = selectedElementId ? layer.findOne(`#${selectedElementId}`) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedElementId, page.elements]);

  // Redraw once web fonts settle so text repaints in the real font.
  useEffect(() => {
    layerRef.current?.batchDraw();
  }, [fontsTick]);

  // Report whether anything on this face reaches into the reserved strip.
  // Measured from the rendered nodes rather than the stored coordinates because
  // a text element's height depends on wrapping and on which font has actually
  // loaded — the stored box would say "fits" for text that visibly doesn't.
  // Re-measured on every element change and once fonts settle.
  useLayoutEffect(() => {
    if (!onReservedFooterOverlapChange) return;
    const layer = layerRef.current;
    if (!layer || reservedTop === null) {
      onReservedFooterOverlapChange(false);
      return;
    }
    const overlaps = layer.find(".element").some((node) => {
      const box = node.getClientRect({ relativeTo: layer });
      // The same predicate the print engine's band is derived from, rather than
      // a second copy of "does it cross the line" that could drift from it.
      return box.height > 0 && isInBackReservedFooter(box);
    });
    onReservedFooterOverlapChange(overlaps);
  }, [onReservedFooterOverlapChange, page.elements, reservedTop, fontsTick]);

  const selected = page.elements.find((el) => el.id === selectedElementId) ?? null;
  // Text + QR scale uniformly (font/box together, square QR). A shape resizes
  // freely, so a rectangle/ellipse/line can be stretched into any proportion. An
  // image resizes freely too unless the panel's "lock aspect" is on.
  const keepRatio =
    selected?.kind === "image" ? lockImageAspect : selected?.kind === "shape" ? false : true;

  // Live alignment guides shown while dragging (Moonpig/Figma style). The snap
  // targets are gathered once at drag start (card lines + the other elements'
  // edges/centres, measured in real design units) and reused for the drag.
  const [guides, setGuides] = useState<SnapLine[]>([]);
  const snapTargetsRef = useRef<{ x: number[]; y: number[] }>({ x: [], y: [] });

  const dragBridge: DragBridge = {
    onStart: (e) => {
      const layer = layerRef.current;
      if (!layer) return;
      const dragged = e.target;
      const cardLines = cardSnapLines();
      const xs = [...cardLines.x];
      const ys = [...cardLines.y];
      // Let an element click flush against the top of the reserved strip, the
      // same way it clicks to the safe margin — the boundary you're asked to
      // respect should be the easiest one to land on.
      if (reservedTop !== null) ys.push(reservedTop);
      // Every other element contributes its left/centre/right and top/middle/
      // bottom as snap lines, so elements align to each other, not just the card.
      layer.find(".element").forEach((node) => {
        if (node === dragged) return;
        const box = node.getClientRect({ relativeTo: layer });
        xs.push(box.x, box.x + box.width / 2, box.x + box.width);
        ys.push(box.y, box.y + box.height / 2, box.y + box.height);
      });
      snapTargetsRef.current = { x: xs, y: ys };
    },
    onMove: (e) => {
      const layer = layerRef.current;
      if (!layer) return;
      const node = e.target;
      // Hold Alt to drag freely (bypass snapping), like other editors.
      if (e.evt.altKey) {
        if (guides.length) setGuides([]);
        return;
      }
      const box = node.getClientRect({ relativeTo: layer });
      const result = computeSnap(box, snapTargetsRef.current);
      // Nudge the node by the snap delta (its origin ≈ the box origin when not
      // rotated; for a rotated box the same delta still pulls it into line).
      node.x(node.x() + (result.x - box.x));
      node.y(node.y() + (result.y - box.y));
      setGuides(result.guides);
    },
    onEnd: () => setGuides([]),
  };

  return (
    <div className="flex w-full max-w-[640px] flex-col gap-2">
      {/* Zoom controls — zoom is relative to fit-to-width (100% = whole card
          visible). Zooming in scrolls the canvas box below. */}
      <div className="flex items-center gap-1 self-end text-sm">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={zoom <= ZOOM_MIN}
          onClick={() => setZoom((z) => steppedZoom(z, -1))}
          className="flex size-8 items-center justify-center rounded-md border border-black/15 text-lg leading-none hover:bg-black/5 disabled:opacity-40 pointer-coarse:size-11 dark:border-white/15 dark:hover:bg-white/5"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          title="Fit to width"
          className="flex min-w-14 items-center justify-center rounded-md border border-black/15 px-2 py-1 text-xs tabular-nums hover:bg-black/5 pointer-coarse:min-h-11 dark:border-white/15 dark:hover:bg-white/5"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={zoom >= ZOOM_MAX}
          onClick={() => setZoom((z) => steppedZoom(z, 1))}
          className="flex size-8 items-center justify-center rounded-md border border-black/15 text-lg leading-none hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/5"
        >
          +
        </button>
      </div>
      {/* At zoom 1 the Stage exactly fits this box; zooming in makes it wider/
          taller and this box scrolls. Measured for the fit-to-width scale. */}
      <div ref={containerRef} className="w-full overflow-auto">
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
        <Layer ref={layerRef}>
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
          {/* The page's own background (colour / image) over the white base;
              non-interactive, so a click still deselects via the base Rect. */}
          <PageBackground background={page.background} />
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
                  drag={dragBridge}
                  fontsTick={fontsTick}
                  onSelect={() => onSelect(element.id)}
                  onChange={onElementChange}
                  onOverflowChange={reportOverflow}
                />
              );
            }
            if (element.kind === "qr") {
              return (
                <QrNode
                  key={element.id}
                  element={element}
                  scale={scale}
                  drag={dragBridge}
                  onSelect={() => onSelect(element.id)}
                  onChange={onElementChange}
                />
              );
            }
            if (element.kind === "shape") {
              return (
                <ShapeNode
                  key={element.id}
                  element={element}
                  scale={scale}
                  drag={dragBridge}
                  onSelect={() => onSelect(element.id)}
                  onChange={onElementChange}
                />
              );
            }
            return (
              <ImageNode
                key={element.id}
                element={element}
                scale={scale}
                drag={dragBridge}
                onSelect={() => onSelect(element.id)}
                onChange={onElementChange}
              />
            );
          })}
          {/* The reserved strip on the back: pre-printed on the stock with the
              Kudos logo and QR. Drawn *over* the elements, and near-opaque, so
              it shows exactly what it shows in print — nothing. Both print paths
              clip to the same line, so this is a preview of the outcome, not a
              polite suggestion. Non-interactive: it must never eat a click meant
              for an element sitting behind it. */}
          {reservedTop !== null && (
            <Group listening={false}>
              <Rect
                x={0}
                y={reservedTop}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT - reservedTop}
                fill="#ffffff"
                opacity={0.92}
              />
              <Line
                points={[0, reservedTop, CANVAS_WIDTH, reservedTop]}
                stroke="#94a3b8"
                strokeWidth={1}
                dash={[4, 4]}
              />
              <Text
                x={0}
                y={reservedTop + 14}
                width={CANVAS_WIDTH}
                align="center"
                text={`Reserved — Kudos logo & QR (bottom ${BACK_RESERVED_FOOTER_MM}mm)`}
                fontSize={14}
                fontFamily="sans-serif"
                fill="#64748b"
              />
            </Group>
          )}
          {/* Alignment guides — thin lines that appear while an element's edge or
              centre lines up with the card or another element. Non-interactive. */}
          {guides.map((g) =>
            g.axis === "x" ? (
              <Line
                key={`x-${g.position}`}
                points={[g.position, 0, g.position, CANVAS_HEIGHT]}
                stroke="#ec4899"
                strokeWidth={1}
                listening={false}
              />
            ) : (
              <Line
                key={`y-${g.position}`}
                points={[0, g.position, CANVAS_WIDTH, g.position]}
                stroke="#ec4899"
                strokeWidth={1}
                listening={false}
              />
            ),
          )}
          <Transformer
            ref={trRef}
            rotateEnabled
            keepRatio={keepRatio}
            enabledAnchors={keepRatio ? CORNER_ANCHORS : undefined}
            anchorStroke="#2563eb"
            anchorFill="#ffffff"
            borderStroke="#2563eb"
            anchorCornerRadius={6}
            // Finger-sized handles on touch, tight handles for a mouse.
            anchorSize={coarsePointer ? 20 : 10}
            rotationSnaps={[0, 90, 180, 270]}
            // Don't let a resize collapse an element to nothing.
            boundBoxFunc={(oldBox, newBox) => {
              const min = MIN_ELEMENT_SIZE * scale;
              if (newBox.width < min || newBox.height < min) return oldBox;
              return newBox;
            }}
          />
        </Layer>
        </Stage>
      </div>
    </div>
  );
}
