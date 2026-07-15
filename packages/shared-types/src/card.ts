import { z } from "zod";

/**
 * Portable, re-editable representation of a card design produced by the
 * canvas editor (Fabric.js/Konva). Stored as JSON, never a flattened image,
 * so a design can be re-opened for editing and re-rendered per recipient
 * (e.g. substituting the {name} token) at print time.
 */
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
  }),
  z.object({
    kind: z.literal("image"),
    id: z.string(),
    assetUrl: z.string().url(),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    rotation: z.number().default(0),
  }),
]);
export type DesignElement = z.infer<typeof designElementSchema>;

export const designPageSchema = z.object({
  name: z.enum(["front", "inside-left", "inside-right", "back"]),
  elements: z.array(designElementSchema),
});
export type DesignPage = z.infer<typeof designPageSchema>;

export const designDocumentSchema = z.object({
  version: z.literal(1),
  pages: z.array(designPageSchema).min(1),
});
export type DesignDocument = z.infer<typeof designDocumentSchema>;

export const cardDesignSchema = z.object({
  id: z.string().uuid(),
  category: z.string(),
  name: z.string(),
  thumbnailUrl: z.string().url(),
  document: designDocumentSchema,
  isActive: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type CardDesign = z.infer<typeof cardDesignSchema>;

/** A personalised instance of a CardDesign, saved to an account's "My Designs". */
export const savedDesignSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  cardDesignId: z.string().uuid(),
  name: z.string(),
  document: designDocumentSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type SavedDesign = z.infer<typeof savedDesignSchema>;
