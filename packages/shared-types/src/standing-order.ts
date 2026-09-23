import { z } from "zod";
import { postageClassSchema } from "./enums";

/**
 * "Click and forget": the standing instruction, as the API speaks it.
 *
 * Named `standingOrder` in code and data. "Campaign" is taken twice already —
 * the admin wallet credit scheme and an occasion type — and a third meaning on
 * the dashboard would be the one too many. A standing order is British, exact,
 * and is literally what this is: an instruction set once and funded from a
 * balance. See docs/adr/0256.
 */

/** How many designs a pool may hold. Enough that a run of cards does not repeat
 * itself; few enough that choosing them is an afternoon, not a project. */
export const STANDING_ORDER_MAX_DESIGNS = 20;

/** How many messages a pool may hold. Same reasoning. */
export const STANDING_ORDER_MAX_MESSAGES = 20;

/**
 * The longest message a pool entry may be.
 *
 * Derived, not guessed. The seeded inside-right message box sits at x=40 on a
 * 450 × 634 canvas at font size 16, so it wraps at 450 − 40 − 16 = 394 units.
 * At the 0.45 glyph-width factor the content pre-flight uses that is about 54
 * characters a line, and from y=40 down to the safe margin there is room for
 * about 27 lines at 1.3 line height — roughly 1,400 characters.
 *
 * 500 is comfortably inside that, so a message that passes here cannot overflow
 * a default card. It is a sanity bound and not a fit guarantee: a subscriber
 * who has moved or shrunk the text box is checked by `card-content.ts` at
 * render, which is the only thing that can know.
 */
export const STANDING_ORDER_MESSAGE_MAX_LENGTH = 500;

/** Who wrote a message. `assisted` is a drafted suggestion the subscriber read
 * and kept — recorded because it is not the same promise as their own words. */
export const standingOrderMessageSourceSchema = z.enum(["written", "assisted"]);
export type StandingOrderMessageSource = z.infer<typeof standingOrderMessageSourceSchema>;

/**
 * How many drafts one press of the button asks for.
 *
 * Enough that a pool is worth varying and the subscriber can throw half away;
 * few enough to read in one go, and to keep a single call small.
 */
export const MESSAGE_DRAFT_COUNT = 6;

/**
 * The longest brief a subscriber may send with a drafting request.
 *
 * Short on purpose. This is the one free-text field that leaves the platform,
 * and a box this size invites "warm, a bit funny, we are a tuition centre"
 * rather than a paragraph about anybody in particular.
 */
export const MESSAGE_DRAFT_BRIEF_MAX_LENGTH = 200;

/** POST /standing-order/message-drafts. The brief is optional: the button has
 *  to work for somebody who just wants six sensible messages. */
export const draftMessagesInputSchema = z.object({
  brief: z.string().trim().max(MESSAGE_DRAFT_BRIEF_MAX_LENGTH).optional(),
});
export type DraftMessagesInput = z.infer<typeof draftMessagesInputSchema>;

/** What comes back: suggestions, saved by nobody until the subscriber says so. */
export const messageDraftsSchema = z.object({
  drafts: z.array(z.string()),
});
export type MessageDrafts = z.infer<typeof messageDraftsSchema>;

/**
 * Which contacts the instruction covers.
 *
 * `all` is the default and the low-barrier answer: a subscriber who picks
 * nothing still gets something sensible rather than an empty form. The other
 * two point at things they already curate.
 */
export const standingOrderAudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("list"), listId: z.string().uuid() }),
  z.object({ kind: z.literal("segment"), segmentId: z.string().uuid() }),
]);
export type StandingOrderAudience = z.infer<typeof standingOrderAudienceSchema>;

export const standingOrderMessageSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  source: standingOrderMessageSourceSchema,
});
export type StandingOrderMessage = z.infer<typeof standingOrderMessageSchema>;

/** A design in the pool, with enough to render a thumbnail beside it.
 *
 * `archived` is reported rather than filtered. Removing a design from the
 * library is a soft archive (ADR 0158), so the pool row survives it — and a
 * pool that silently shrank would be worse than one that says which card can no
 * longer be sent. */
export const standingOrderDesignSchema = z.object({
  savedDesignId: z.string().uuid(),
  name: z.string(),
  archived: z.boolean(),
  /**
   * False when this design has text on its inside page that we cannot tell
   * apart from a message, so a chosen message is not printed on it and the
   * card carries the design's own words (ADR 0260).
   *
   * Reported rather than refused: a birthday with no card at all is the larger
   * failure. But a subscriber who wrote five messages deserves to know which
   * of their cards will not use them, at the point they choose them.
   */
  takesMessage: z.boolean(),
});
export type StandingOrderDesign = z.infer<typeof standingOrderDesignSchema>;

/**
 * Why an instruction that is switched on is nevertheless not running.
 *
 * Separate from `enabled` on purpose. "Off" is a choice somebody made; these
 * are the product declining to act on a choice it can no longer honour, and a
 * customer who is told "on" while nothing happens has been lied to.
 */
export const standingOrderBlockerSchema = z.enum([
  /** The plan does not include automatic sending. */
  "plan",
  /** Nobody has agreed to the current wording. */
  "consent",
  /** The pool has no designs, or no messages. */
  "empty_pool",
  /** A design in the pool has been archived out of the library. */
  "design_archived",
  /** The list or segment it pointed at has been deleted. */
  "audience_gone",
  /**
   * The audience is a smart list, which automatic approval does not act on.
   *
   * A smart list is a rule, and an occasion-mode one ("Birthdays this month")
   * carries a rolling date window — so its membership moves on its own, and
   * approving cards for whoever it happened to match this morning is not a
   * decision anybody made. Reported rather than silently half-handled.
   */
  "audience_unsupported",
]);
export type StandingOrderBlocker = z.infer<typeof standingOrderBlockerSchema>;

export const standingOrderSchema = z.object({
  /** Null until the account has ever saved one. */
  id: z.string().uuid().nullable(),
  enabled: z.boolean(),
  audience: standingOrderAudienceSchema,
  postageClass: postageClassSchema,
  designs: z.array(standingOrderDesignSchema),
  messages: z.array(standingOrderMessageSchema),
  /** Whether it is actually running: switched on, with nothing blocking it. */
  active: z.boolean(),
  /** Everything standing between "on" and "running". Empty when active. */
  blockers: z.array(standingOrderBlockerSchema),
  /** The consent on record, if any. */
  consent: z
    .object({
      consentedAt: z.coerce.date(),
      version: z.number().int(),
      /** False when the wording has changed since they agreed. */
      current: z.boolean(),
    })
    .nullable(),
  /** The wording they must agree to, and the version it carries. */
  consentStatement: z.array(z.string()),
  consentVersion: z.number().int(),
  /** Whether this account's plan permits automatic sending at all. Free sees
   * the whole feature with this false, and an upgrade prompt. */
  planAllows: z.boolean(),
  /**
   * Whether this deployment can draft messages at all.
   *
   * A fact about the server rather than about the instruction, and it lives
   * here because this page is the only thing that asks. False when no model is
   * configured, and the page then offers no button — better than a button that
   * apologises. See ADR 0263.
   */
  messageDraftingAvailable: z.boolean(),
});
export type StandingOrder = z.infer<typeof standingOrderSchema>;

/**
 * PUT /standing-order body: the whole instruction, every time.
 *
 * Whole rather than patched, for the reason the automatic top-up is
 * (ADR 0255): switching this on without saying which cards and which words is
 * not a decision anybody made. `agreeToConsent` is separate from `enabled`
 * because agreeing and switching on are two different acts, and somebody
 * turning it back on later should not silently re-agree to wording they have
 * not seen.
 */
export const saveStandingOrderInputSchema = z.object({
  enabled: z.boolean(),
  audience: standingOrderAudienceSchema,
  postageClass: postageClassSchema,
  savedDesignIds: z.array(z.string().uuid()).max(STANDING_ORDER_MAX_DESIGNS),
  messages: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(STANDING_ORDER_MESSAGE_MAX_LENGTH),
        source: standingOrderMessageSourceSchema.default("written"),
      }),
    )
    .max(STANDING_ORDER_MAX_MESSAGES),
  /** True when the caller is agreeing to the current statement. */
  agreeToConsent: z.boolean().default(false),
});
export type SaveStandingOrderInput = z.infer<typeof saveStandingOrderInputSchema>;
