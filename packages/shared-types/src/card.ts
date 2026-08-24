import { z } from "zod";

/**
 * Portable, re-editable representation of a card design produced by the
 * canvas editor (Fabric.js/Konva). Stored as JSON, never a flattened image,
 * so a design can be re-opened for editing and re-rendered per recipient
 * (e.g. substituting the {name} token) at print time.
 */
/**
 * A placeable image source: an absolute http(s) URL (an uploaded asset) or a
 * root-relative path (a self-hosted app asset, e.g. a `/stickers/*.svg`
 * sticker). Loosened from a strict URL so bundled stickers can be referenced
 * without coupling to the deployed domain; existing absolute URLs still pass.
 */
export function isImageAssetSrc(value: string): boolean {
  return /^https?:\/\//.test(value) || value.startsWith("/");
}

export const designElementSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    id: z.string(),
    /** May contain merge tokens such as "Dear {name},". */
    text: z.string(),
    x: z.number(),
    y: z.number(),
    fontFamily: z.string(),
    fontSize: z.number().positive(),
    color: z.string(),
    /**
     * Wrap width of the text box in design units. When set, text word-wraps
     * within this box (the editor's adjustable "text width" guard rail). When
     * omitted, it wraps to the card's right edge — the legacy behaviour, kept
     * so existing designs render unchanged.
     */
    width: z.number().positive().optional(),
    /** Horizontal alignment within the text box. Defaults to left. */
    align: z.enum(["left", "center", "right"]).optional(),
    /**
     * Rotation in degrees, clockwise. Additive + optional so existing designs
     * (which have no rotation) render unchanged; the canvas Transformer's rotate
     * handle and the read-only previews both honour it. Defaults to 0.
     */
    rotation: z.number().optional(),
    /**
     * Type styling toggles. Additive + optional so existing designs render
     * unchanged (all default off). `bold`/`italic` map to Konva's `fontStyle`
     * (see `konvaFontStyle`); `underline` maps to `textDecoration`. Both
     * renderers honour them.
     */
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("image"),
    id: z.string(),
    /** An uploaded asset URL or a root-relative app asset (e.g. a sticker). */
    assetUrl: z.string().refine(isImageAssetSrc, {
      message: "must be an http(s) URL or a root-relative path",
    }),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    rotation: z.number().default(0),
  }),
  z.object({
    /**
     * A QR code printed on the card that resolves to the recipient's digital
     * message page (/r/<slug>), where they watch the linked video. The slug is
     * per-sent-card, so the element only carries placement — the actual URL is
     * substituted per recipient at render time (like the {name} text token).
     */
    kind: z.literal("qr"),
    id: z.string(),
    x: z.number(),
    y: z.number(),
    /** QR codes are square; a single side length in canvas units. */
    size: z.number().positive(),
    rotation: z.number().default(0),
  }),
  z.object({
    /**
     * A native vector shape (drawn with Konva primitives, not an image) — crisp
     * at any size and recolourable. Additive kind, so existing designs are
     * unaffected. Positioned by its top-left box (x/y/width/height) like an
     * image; `fill`/`stroke`/`strokeWidth` style it (a `line` uses stroke only),
     * `cornerRadius` rounds a `rect`.
     */
    kind: z.literal("shape"),
    id: z.string(),
    shape: z.enum(["rect", "ellipse", "triangle", "star", "heart", "line"]),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    fill: z.string().optional(),
    stroke: z.string().optional(),
    strokeWidth: z.number().nonnegative().optional(),
    cornerRadius: z.number().nonnegative().optional(),
    rotation: z.number().default(0),
  }),
]);
export type DesignElement = z.infer<typeof designElementSchema>;
export type ShapeKind = Extract<DesignElement, { kind: "shape" }>["shape"];

/**
 * A page's background fill, drawn behind its elements. Additive + optional on
 * the page: when omitted a page is plain white (the legacy behaviour), so
 * existing designs render unchanged. An image background covers the whole face
 * (centre-cropped to fill — see `coverCrop`).
 */
export const pageBackgroundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("color"), color: z.string() }),
  z.object({ type: z.literal("image"), assetUrl: z.string().url() }),
]);
export type PageBackground = z.infer<typeof pageBackgroundSchema>;

export const designPageSchema = z.object({
  name: z.enum(["front", "inside-left", "inside-right", "back"]),
  elements: z.array(designElementSchema),
  /** Optional background fill drawn behind the elements. Omitted = white. */
  background: pageBackgroundSchema.optional(),
});
export type DesignPage = z.infer<typeof designPageSchema>;

export const designDocumentSchema = z.object({
  version: z.literal(1),
  pages: z.array(designPageSchema).min(1),
  /**
   * The account Message Page this card's QR resolves to (ADR 0137). Chosen in
   * the designer; carried through the send flow as the default and honoured at
   * settlement for every order path. Takes precedence over `videoUrl` — which
   * remains a shortcut that auto-builds a minimal page. `null`/absent means "no
   * page chosen; use the video link (if any)". A page later archived/deleted
   * degrades to `videoUrl`/none at settlement. Only meaningful with a `qr`
   * element on the card.
   */
  messagePageId: z.string().uuid().nullable().optional(),
  /**
   * Default video the card's QR code links to when no message page is chosen.
   * Copied onto each recipient's auto-created message page when an order is paid
   * (and overridable per recipient from the Messages page). Only meaningful when
   * a `qr` element is placed on the card.
   */
  videoUrl: z.string().url().nullable().optional(),
});
export type DesignDocument = z.infer<typeof designDocumentSchema>;

/**
 * The Message Page a design's QR is linked to, or null. A thin accessor so web
 * (pre-selecting the send-flow default) and any other reader share one notion
 * of "what page did the designer choose" (ADR 0137).
 */
export function linkedMessagePageId(document: DesignDocument | null | undefined): string | null {
  return document?.messagePageId ?? null;
}

/**
 * Whether a design places a QR element on any face. The QR resolves to the
 * recipient's digital message page, so the send flow offers to attach a message
 * page only when this is true (ADR 0132). Defensive against loosely-typed
 * documents read from storage.
 */
export function hasQrElement(document: DesignDocument | null | undefined): boolean {
  if (!document || !Array.isArray(document.pages)) return false;
  return document.pages.some((page) =>
    Array.isArray(page.elements) && page.elements.some((element) => element.kind === "qr"),
  );
}

export const cardDesignSchema = z.object({
  id: z.string().uuid(),
  category: z.string(),
  name: z.string(),
  /** Public URL slug — `/cards/<category>/<slug>`. Stable for the life of the
   * design; see docs/adr/0163-catalog-urls-and-category-pages.md. */
  slug: z.string(),
  thumbnailUrl: z.string().url(),
  document: designDocumentSchema,
  isActive: z.boolean(),
  /** Airtable record id this design was synced from; null for seeded templates. */
  externalId: z.string().nullable(),
  /** Human-facing product code from Airtable (e.g. "KC-BDAY-GEN-001"); null for seeds. */
  sku: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type CardDesign = z.infer<typeof cardDesignSchema>;

/** A personalised instance of a CardDesign, saved to an account's "My Designs". */
export const savedDesignSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  /** Null for a member's own uploaded artwork (no catalog template behind it). */
  cardDesignId: z.string().uuid().nullable(),
  name: z.string(),
  document: designDocumentSchema,
  /** Set when a design that's referenced by past orders/occasions is "deleted":
   * it can't be hard-removed without breaking that history, so it's archived out
   * of the library instead. The gallery only ever lists un-archived designs, so
   * this is null there — present for completeness. See docs/adr/0158. */
  archivedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type SavedDesign = z.infer<typeof savedDesignSchema>;

/** Result of DELETE /saved-designs/:id — whether the design was fully removed or
 * archived (kept for the order/occasion history that still references it). */
export const deleteSavedDesignResultSchema = z.object({
  archived: z.boolean(),
});
export type DeleteSavedDesignResult = z.infer<typeof deleteSavedDesignResultSchema>;

/**
 * A reusable image an account uploaded in the designer — the "Your uploads"
 * library, so a logo/photo can be placed again without re-uploading. `url` is
 * the public storage URL a design document references.
 */
export const designAssetSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  fileName: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  createdAt: z.coerce.date(),
});
export type DesignAsset = z.infer<typeof designAssetSchema>;

/** Body for recording a completed upload into the library. */
export const createDesignAssetSchema = z.object({
  url: z.string().url(),
  fileName: z.string().min(1).max(200),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type CreateDesignAssetInput = z.infer<typeof createDesignAssetSchema>;

/**
 * Every image asset one face references, background first then elements, in
 * document order and deduplicated.
 *
 * Used to offer an operator the *original uploaded file* rather than a render of
 * it. A card face is authored in a fixed 450×634 space and a background is
 * cover-cropped into it, so anything derived from the canvas has already lost
 * whatever fell outside the crop — and, on the back, whatever falls in the
 * reserved footer. The only faithful copy of what a customer supplied is the
 * asset itself. See docs/adr/0166.
 */
export function faceAssetUrls(document: DesignDocument, face: DesignPage["name"]): string[] {
  const page = document.pages.find((p) => p.name === face);
  if (!page) return [];
  const urls: string[] = [];
  if (page.background?.type === "image") urls.push(page.background.assetUrl);
  for (const element of page.elements) {
    if (element.kind === "image") urls.push(element.assetUrl);
  }
  return [...new Set(urls)];
}

/**
 * Every image asset URL anywhere in a document.
 *
 * The server uses this to decide whether a URL an operator asked to download is
 * one this design actually references. A design document carries
 * customer-supplied URLs and the download is fetched server-side, so accepting a
 * URL on the client's word would be a confused-deputy SSRF vector; membership of
 * the stored document is the check that closes it.
 */
export function documentAssetUrls(document: DesignDocument): Set<string> {
  const urls = new Set<string>();
  for (const page of document.pages) {
    if (page.background?.type === "image") urls.add(page.background.assetUrl);
    for (const element of page.elements) {
      if (element.kind === "image") urls.add(element.assetUrl);
    }
  }
  return urls;
}
