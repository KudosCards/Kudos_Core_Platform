"use client";

import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Stage, Layer, Rect, Text, Group, Line, Image as KonvaImage } from "react-konva";
import useImage from "use-image";
import type { CardSize, DesignDocument, DesignElement, DesignPage } from "@kudos/shared-types";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  DEFAULT_CARD_SIZE,
  backReservedFooterTop,
  coverCropLoss,
  konvaFontStyle,
  konvaTextDecoration,
  revealedCrop,
  textWrapWidth,
} from "@kudos/shared-types";
import { FontPreloader, resolveFontFamily } from "@/lib/editor-fonts";
import { useFontsReady } from "@/lib/use-fonts-ready";
import { qrDataUrl } from "@/lib/qr";
import { PageBackground } from "@/components/page-background";
import { ShapePrimitive } from "@/components/card-shape";

// The card canvas is authored at 450×634 (see the editor's design-canvas). This
// renders the front page read-only at an arbitrary display width, scaling the
// whole stage so element coordinates stay correct.
const CANVAS_WIDTH = CARD_WIDTH;
const CANVAS_HEIGHT = CARD_HEIGHT;

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
 * A QR element rendered as its *real* scannable code when `qrUrl` is supplied
 * (the print run passes each card's /r/<slug> link) — otherwise a plain marked
 * square, so the designer preview keeps showing the QR's position without a code
 * that doesn't exist yet. The PNG is generated off-thread by `qrDataUrl` and
 * drawn once ready; until then (or with no url) the placeholder square shows.
 */
function QrNode({
  element,
  qrUrl,
}: {
  element: Extract<DesignElement, { kind: "qr" }>;
  qrUrl?: string;
}) {
  // Keyed to the url it was generated for, so a changed qrUrl invalidates the
  // stale code without a synchronous state reset inside the effect.
  const [rendered, setRendered] = useState<{ url: string; data: string } | null>(null);

  useEffect(() => {
    if (!qrUrl) return;
    let active = true;
    void qrDataUrl(qrUrl).then((data) => {
      if (active) setRendered({ url: qrUrl, data });
    });
    return () => {
      active = false;
    };
  }, [qrUrl]);

  const dataUrl = qrUrl && rendered?.url === qrUrl ? rendered.data : null;
  const [image] = useImage(dataUrl ?? "");
  if (dataUrl && image) {
    return (
      <KonvaImage
        image={image}
        x={element.x}
        y={element.y}
        width={element.size}
        height={element.size}
        rotation={element.rotation}
      />
    );
  }

  // QR placeholder — no real code available (designer preview) or still
  // rendering; a plain marked square keeps its position visible.
  return (
    <Rect
      x={element.x}
      y={element.y}
      width={element.size}
      height={element.size}
      rotation={element.rotation}
      fill="#0000000d"
      stroke="#00000026"
      strokeWidth={1}
    />
  );
}

/**
 * A non-interactive render of one of a design's faces — used to show a card
 * exactly as it'll print, including merged {name} text (pass a document that's
 * already been through applyMergeTokens). Defaults to the `front` face; pass
 * `face` to render an inside or back face (the flip viewer uses this to let a
 * sender review the personalised message, not just the cover). Client-only:
 * Konva touches canvas APIs, so callers import this with
 * `dynamic(..., { ssr: false })`.
 */
export function CardFacePreview({
  document,
  width = 225,
  face = "front",
  bordered = true,
  qrUrl,
  pixelRatio,
  size = DEFAULT_CARD_SIZE,
  artworkView = "as-printed",
}: {
  document: DesignDocument;
  width?: number;
  face?: DesignPage["name"];
  /** Draw the thin frame around the face. On by default for inline previews;
   * the print run turns it off so nothing but the artwork reaches the page. */
  bordered?: boolean;
  /** The absolute link this card's QR should encode (e.g. /r/<slug>). When set,
   * QR elements render as a real scannable code; without it they stay a marked
   * placeholder square (designer preview, before a code is minted). */
  qrUrl?: string;
  /** Backing-store density for the Konva canvas. Omitted = the device's own
   * devicePixelRatio (fine for on-screen previews). The print run passes a high
   * value so the rasterised face carries enough pixels to print sharply (the
   * canvas CSS size is unchanged — only the pixel count behind it grows). */
  pixelRatio?: number;
  /** Trim size this face will be printed at. Only affects where the back's
   * reserved footer falls (30mm is a different fraction of an A6 than an A5). */
  size?: CardSize;
  /**
   * What the face shows: exactly what prints, or everything the artwork
   * contains.
   *
   * `"full"` turns off both of the things that hide artwork from an operator —
   * the back's reserved-footer clip, and the crop that fits a background to the
   * card's shape — and *marks* what they remove instead. It exists because the
   * printed render is the one view guaranteed not to answer "what is being cut
   * off?": the part in question is the part that is gone.
   *
   * In `"full"` the whole card is scaled down into the rectangle that prints,
   * so the discarded band can be drawn around it at the same scale. Never the
   * default — a preview shows what prints unless asked otherwise.
   */
  artworkView?: "as-printed" | "full";
}) {
  const scale = width / CANVAS_WIDTH;
  const revealing = artworkView === "full";

  // The bottom strip of the back is pre-printed on our card stock with the Kudos
  // logo and QR, so nothing authored may show there — see card-format.ts
  // BACK_RESERVED_FOOTER_MM. Clipped by default, in the one read-only renderer
  // every preview and the browser print overlay share, so what anyone is shown
  // matches what the server-side PDF engine will lay down (print-pdf/render.ts
  // applies the identical clip). The clip covers the page background too: a
  // full-bleed image on the back would otherwise cover the branding.
  //
  // `reservedFooter: "reveal"` turns the clip off and marks the band instead —
  // the only way to review artwork whose lost part is the part being judged.
  // The print engine is unaffected either way; it is the actual guarantee.
  const reservedTop = face === "back" ? backReservedFooterTop(size) : null;
  const clip =
    reservedTop !== null && !revealing
      ? { x: 0, y: 0, width: CANVAS_WIDTH, height: reservedTop }
      : undefined;
  const front =
    document.pages.find((page) => page.name === face) ??
    document.pages.find((page) => page.name === "front") ??
    document.pages[0];
  const elements = front?.elements ?? [];

  // The web fonts this design actually uses — so the preloader warms only those,
  // not the whole catalogue, for a read-only preview.
  const usedFontKeys = Array.from(
    new Set(elements.filter((el) => el.kind === "text").map((el) => el.fontFamily)),
  );

  // The background's own pixel size, needed to lay the reveal out. Loaded here as
  // well as in PageBackground: it is the same url, so the browser serves the
  // second request from cache, and the alternative is threading a measurement
  // back up out of a child that every other renderer shares.
  const backgroundUrl =
    revealing && front?.background?.type === "image" ? front.background.assetUrl : "";
  const [backgroundImage] = useImage(backgroundUrl, "anonymous");

  /**
   * Where the whole artwork goes and which part of it prints — null whenever
   * there is nothing to reveal, which is the common case: not in reveal mode,
   * no image background, or artwork already the card's shape. A band drawn on a
   * card that loses nothing would be a lie in the one view meant to be trusted.
   */
  const reveal = (() => {
    if (!backgroundImage) return null;
    const natural = { width: backgroundImage.width, height: backgroundImage.height };
    const box = { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
    const loss = coverCropLoss(natural, box);
    if (loss.widthLost <= 0 && loss.heightLost <= 0) return null;
    return revealedCrop(natural, box);
  })();

  // The card itself, scaled into the rectangle that prints so the discarded
  // artwork can be drawn around it at the same scale. Identity when nothing is
  // being revealed.
  const cardTransform = reveal
    ? {
        x: reveal.printed.x,
        y: reveal.printed.y,
        scaleX: reveal.printed.width / CANVAS_WIDTH,
        scaleY: reveal.printed.height / CANVAS_HEIGHT,
      }
    : { x: 0, y: 0, scaleX: 1, scaleY: 1 };

  // Redraw once fonts settle so text paints in the real font, not the fallback.
  const stageRef = useRef<Konva.Stage>(null);
  const fontsTick = useFontsReady();
  useEffect(() => {
    stageRef.current?.batchDraw();
  }, [fontsTick]);

  // Push a high backing-store density onto each layer's canvas for print. Konva
  // defaults every canvas to the device's devicePixelRatio; overriding it here
  // (only when a caller asks) grows the pixel count behind the same CSS-sized
  // face, which is what makes the printed/saved-PDF artwork sharp. Re-applied
  // whenever the face, its size, or the fonts change, since a Konva redraw can
  // otherwise recreate the canvas at the default ratio.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !pixelRatio) return;
    stage.getLayers().forEach((layer) => {
      layer.getCanvas().setPixelRatio(pixelRatio);
    });
    stage.batchDraw();
  }, [pixelRatio, width, face, document, fontsTick]);

  return (
    <>
      <FontPreloader only={usedFontKeys} />
      <Stage
        ref={stageRef}
        width={width}
        height={CANVAS_HEIGHT * scale}
        scaleX={scale}
        scaleY={scale}
        className={bordered ? "rounded-md border border-black/10 bg-white" : "bg-white"}
      >
        <Layer listening={false}>
          <Rect x={0} y={0} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="#ffffff" />
          {/* The whole artwork, behind the card, when revealing. Drawn
              uncropped — that is the entire point of the view — with the card
              itself scaled down onto the part of it that prints. */}
          {reveal && backgroundImage && (
            <KonvaImage
              x={reveal.drawn.x}
              y={reveal.drawn.y}
              width={reveal.drawn.width}
              height={reveal.drawn.height}
              image={backgroundImage}
              listening={false}
            />
          )}
          {/* One Group rather than a second Layer: a Layer is a whole extra
              canvas, and these previews are rendered dozens at a time in the
              design and review grids. */}
          <Group {...cardTransform}>
            <Group clip={clip}>
              <PageBackground background={front?.background} />
              {elements.map((element) => {
                if (element.kind === "text") {
                  return (
                    <Text
                      key={element.id}
                      text={element.text}
                      x={element.x}
                      y={element.y}
                      width={textWrapWidth(element)}
                      align={element.align ?? "left"}
                      wrap="word"
                      lineHeight={1.3}
                      fontFamily={resolveFontFamily(element.fontFamily)}
                      fontSize={element.fontSize}
                      fontStyle={konvaFontStyle(element.bold, element.italic)}
                      textDecoration={konvaTextDecoration(element.underline)}
                      fill={element.color}
                      rotation={element.rotation}
                    />
                  );
                }
                if (element.kind === "image") {
                  return <ImageNode key={element.id} element={element} />;
                }
                if (element.kind === "shape") {
                  return (
                    <Group key={element.id} x={element.x} y={element.y} rotation={element.rotation}>
                      <ShapePrimitive element={element} />
                    </Group>
                  );
                }
                // Real per-card QR when a link is supplied (print run), else a marked
                // placeholder square (designer preview, before a code is minted).
                return <QrNode key={element.id} element={element} qrUrl={qrUrl} />;
              })}
            </Group>
            {/* Reveal mode: nothing is hidden, so the band has to be *marked* or
                there is no way to tell which part of the artwork won't print. A
                tint light enough to read the artwork through, and a rule on the
                line itself. Inside the card transform, so it tracks the card
                when the reveal scales it down. */}
            {reservedTop !== null && revealing && (
              <Group listening={false}>
                <Rect
                  x={0}
                  y={reservedTop}
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT - reservedTop}
                  fill="#ffffff"
                  opacity={0.35}
                />
                <Line
                  points={[0, reservedTop, CANVAS_WIDTH, reservedTop]}
                  stroke="#dc2626"
                  strokeWidth={1.5}
                  dash={[8, 5]}
                />
              </Group>
            )}
          </Group>
          {/* The artwork that will not be printed: everything of `drawn` outside
              `printed`. Dimmed rather than hidden — the question being asked is
              what is in there — with the trim line ruled so the boundary is
              unambiguous. Four bands, of which at most two are ever non-empty,
              because a cover-crop only trims one axis. */}
          {reveal && (
            <Group listening={false}>
              {[
                {
                  x: reveal.drawn.x,
                  y: reveal.drawn.y,
                  width: reveal.drawn.width,
                  height: reveal.printed.y - reveal.drawn.y,
                },
                {
                  x: reveal.drawn.x,
                  y: reveal.printed.y + reveal.printed.height,
                  width: reveal.drawn.width,
                  height:
                    reveal.drawn.y +
                    reveal.drawn.height -
                    (reveal.printed.y + reveal.printed.height),
                },
                {
                  x: reveal.drawn.x,
                  y: reveal.printed.y,
                  width: reveal.printed.x - reveal.drawn.x,
                  height: reveal.printed.height,
                },
                {
                  x: reveal.printed.x + reveal.printed.width,
                  y: reveal.printed.y,
                  width:
                    reveal.drawn.x + reveal.drawn.width - (reveal.printed.x + reveal.printed.width),
                  height: reveal.printed.height,
                },
              ]
                .filter((band) => band.width > 0.01 && band.height > 0.01)
                .map((band, i) => (
                  <Rect key={i} {...band} fill="#000000" opacity={0.45} />
                ))}
              <Rect
                x={reveal.printed.x}
                y={reveal.printed.y}
                width={reveal.printed.width}
                height={reveal.printed.height}
                stroke="#dc2626"
                strokeWidth={1.5}
                dash={[8, 5]}
              />
            </Group>
          )}
        </Layer>
      </Stage>
    </>
  );
}
