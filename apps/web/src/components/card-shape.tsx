"use client";

import { Rect, Ellipse, Line, Star, Path } from "react-konva";
import type { DesignElement } from "@kudos/shared-types";

// A filled heart in a 24×24 box (Material "favorite" path), scaled to fit.
const HEART_PATH =
  "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";
const HEART_VIEWBOX = 24;

/**
 * Draws a vector shape in local box coordinates [0..width, 0..height]. Rendered
 * inside a Group positioned at the element's x/y (with rotation) by both the
 * editor canvas and the read-only preview, so shapes look identical everywhere.
 * A transparent hit rect makes the whole box grabbable even for hollow shapes
 * (a line, or a shape with no fill).
 */
export function ShapePrimitive({
  element,
}: {
  element: Extract<DesignElement, { kind: "shape" }>;
}) {
  const { width: w, height: h, fill, stroke, strokeWidth, cornerRadius, shape } = element;
  const style = { fill, stroke, strokeWidth };

  let node: React.ReactNode = null;
  switch (shape) {
    case "rect":
      node = <Rect x={0} y={0} width={w} height={h} cornerRadius={cornerRadius} {...style} />;
      break;
    case "ellipse":
      node = <Ellipse x={w / 2} y={h / 2} radiusX={w / 2} radiusY={h / 2} {...style} />;
      break;
    case "triangle":
      node = <Line points={[w / 2, 0, w, h, 0, h]} closed {...style} />;
      break;
    case "star": {
      const outer = Math.min(w, h) / 2;
      node = (
        <Star
          x={w / 2}
          y={h / 2}
          numPoints={5}
          innerRadius={outer * 0.5}
          outerRadius={outer}
          {...style}
        />
      );
      break;
    }
    case "heart":
      node = (
        <Path data={HEART_PATH} scaleX={w / HEART_VIEWBOX} scaleY={h / HEART_VIEWBOX} {...style} />
      );
      break;
    case "line":
      node = (
        <Line
          points={[0, h / 2, w, h / 2]}
          stroke={stroke ?? "#111111"}
          strokeWidth={strokeWidth ?? 4}
          lineCap="round"
        />
      );
      break;
  }

  return (
    <>
      {/* Invisible but hit-testable, so the whole box selects/drags. */}
      <Rect x={0} y={0} width={w} height={h} fill="transparent" />
      {node}
    </>
  );
}
