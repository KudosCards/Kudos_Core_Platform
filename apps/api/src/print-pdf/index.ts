/**
 * Public surface of the server-side card→PDF engine (docs/adr/0162).
 * See render.ts for the pipeline; geometry/fonts/text-layout/shapes/qr/color are
 * the reusable, individually-tested pieces.
 */
export { renderRunPdf } from "./render";
export type { PrintFaceInput, RenderRunOptions, ImageResolver, ResolvedImage } from "./render";
export { createImageResolver, decodeImage, absoluteUrl, isHostAllowed, hostOf } from "./image-loader";
export type { ImageResolverOptions, FetchLike } from "./image-loader";
export { faceGeometry, cropMarks, BLEED_MM, PT_PER_MM } from "./geometry";
export type { FaceGeometry } from "./geometry";
export { resolveFace } from "./fonts";
export { wrapText, baselineMetrics, alignOffset, LINE_HEIGHT } from "./text-layout";
export { parseColor } from "./color";
