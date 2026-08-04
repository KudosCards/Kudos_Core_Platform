import { z } from "zod";
import { occasionTypeSchema, recipientStatusSchema } from "./enums";
import { recipientSchema } from "./recipient";

/**
 * Segments (smart lists) — a saved, live-resolving filter over the contact book.
 * A segment either targets **occasions** (dated + typed, e.g. "birthdays this
 * month" — keeps per-year de-dup and lifecycle) or **contacts** (undated, e.g.
 * "everyone missing an address"). System-suggested segments are code-defined
 * presets; users can also save their own. The first slice only *resolves* a
 * segment to a count + preview — sending is a later slice.
 * See docs/adr/0105-segments-smart-lists.md.
 */

/** The date window an occasion-mode segment matches against `occasionDate`. */
export const segmentWindowSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("this_month") }),
  z.object({ kind: z.literal("next_days"), days: z.number().int().positive().max(366) }),
  z.object({
    kind: z.literal("range"),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
]);
export type SegmentWindow = z.infer<typeof segmentWindowSchema>;

/** A segment's filter. `occasion` present ⇒ occasion-mode; otherwise contact-mode. */
export const segmentDefinitionSchema = z
  .object({
    occasion: z
      .object({
        types: z.array(occasionTypeSchema).min(1),
        window: segmentWindowSchema,
      })
      .optional(),
    contact: z
      .object({
        source: z.string().optional(),
        listId: z.string().uuid().optional(),
        status: recipientStatusSchema.optional(),
        /** false ⇒ only contacts missing a mailable address. */
        hasMailableAddress: z.boolean().optional(),
      })
      .optional(),
  })
  .refine((d) => d.occasion !== undefined || d.contact !== undefined, {
    message: "A segment needs an occasion or a contact filter",
  });
export type SegmentDefinition = z.infer<typeof segmentDefinitionSchema>;

/** One previewed member of a resolved segment. */
export const segmentMemberSchema = z.object({
  recipientId: z.string().uuid(),
  name: z.string(),
  /** A short line of context — "Birthday · 23 Oct" or "No postal address". */
  detail: z.string(),
});
export type SegmentMember = z.infer<typeof segmentMemberSchema>;

/** A segment (suggested or saved) resolved to its live count + a small sample. */
export const segmentSummarySchema = z.object({
  /** The saved segment's id; null for a code-defined suggested preset. */
  id: z.string().uuid().nullable(),
  /** Stable key for React (preset slug or the saved id). */
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  definition: segmentDefinitionSchema,
  count: z.number().int().nonnegative(),
  sample: z.array(segmentMemberSchema),
  suggested: z.boolean(),
});
export type SegmentSummary = z.infer<typeof segmentSummarySchema>;

/** The /segments overview: suggested presets + the account's saved segments,
 * each already resolved to a live count + sample. */
export const segmentsOverviewSchema = z.object({
  suggested: z.array(segmentSummarySchema),
  saved: z.array(segmentSummarySchema),
});
export type SegmentsOverview = z.infer<typeof segmentsOverviewSchema>;

/**
 * A segment resolved to its full member recipients, for seeding the bulk-send
 * composer ("Send to this list"). Unlike the overview's `sample`, this carries
 * whole Recipient records so the composer can preview, fix addresses, and price
 * without re-fetching. Capped at the plan's per-order limit; `total` is the true
 * (uncapped) member count and `capped` says the cap trimmed the set.
 * See docs/adr/0106-send-to-segment.md.
 */
export const segmentMembersSchema = z.object({
  /** The segment's name, for the composer's "Sending to …" heading. */
  name: z.string(),
  members: z.array(recipientSchema),
  /** Distinct member count before the per-order cap was applied. */
  total: z.number().int().nonnegative(),
  /** True when `total` exceeds the plan cap, so `members` is a trimmed prefix. */
  capped: z.boolean(),
});
export type SegmentMembers = z.infer<typeof segmentMembersSchema>;

/** Save a new segment. */
export const createSegmentInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  definition: segmentDefinitionSchema,
});
export type CreateSegmentInput = z.infer<typeof createSegmentInputSchema>;
