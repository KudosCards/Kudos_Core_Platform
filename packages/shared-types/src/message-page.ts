import { z } from "zod";
import { VIDEO_EMBED_PROVIDERS } from "./video";

/**
 * Message Pages v2 — the account-owned "library" contract (ADR 0132). These are
 * the reusable/bespoke page records a member authors and manages, distinct from
 * the v1 per-card personalise row in `order.ts` (`messagePageSchema`). The API
 * DTOs (class-validator) and the web builder both defer to the limits and shapes
 * declared here so the two surfaces can't drift.
 */

export const messagePageStatusSchema = z.enum(["active", "archived"]);
export type MessagePageStatus = z.infer<typeof messagePageStatusSchema>;

export const messagePageVideoTypeSchema = z.enum(["none", "embed", "upload"]);
export type MessagePageVideoType = z.infer<typeof messagePageVideoTypeSchema>;

export const messagePageVideoProviderSchema = z.enum(VIDEO_EMBED_PROVIDERS);
export type MessagePageVideoProvider = z.infer<typeof messagePageVideoProviderSchema>;

/** Single source of truth for field limits, shared by API DTOs + web forms. */
export const MESSAGE_PAGE_LIMITS = {
  title: 120,
  /** Pre-sanitise cap on the raw HTML the builder submits; the stored, sanitised
   * result is typically shorter. */
  message: 5000,
  emoji: 8,
  ctaLabel: 40,
  recipientName: 80,
  /** A recipient's reply (Phase 2): plain text, capped. */
  replyBody: 2000,
  replySenderName: 80,
} as const;

/**
 * Create payload. `title` is the only required field; everything else is opt-in
 * so a page can start as just a heading and grow. `videoUrl` is validated
 * server-side via `parseVideoEmbed` (embed-only in Phase 1) — an unrecognised
 * URL is rejected. A CTA needs both a label and an https URL or neither.
 */
export const createMessagePageInputSchema = z.object({
  title: z.string().trim().min(1).max(MESSAGE_PAGE_LIMITS.title),
  message: z.string().max(MESSAGE_PAGE_LIMITS.message).nullish(),
  emoji: z.string().max(MESSAGE_PAGE_LIMITS.emoji).nullish(),
  videoUrl: z.string().url().nullish(),
  ctaLabel: z.string().max(MESSAGE_PAGE_LIMITS.ctaLabel).nullish(),
  ctaUrl: z.string().url().nullish(),
  allowReplies: z.boolean().optional(),
  recipientName: z.string().max(MESSAGE_PAGE_LIMITS.recipientName).nullish(),
});
export type CreateMessagePageInput = z.infer<typeof createMessagePageInputSchema>;

/** Update payload — every content field independently clearable; `status` lets
 * the library archive/restore a page. */
export const updateMessagePageInputSchema = createMessagePageInputSchema.partial().extend({
  status: messagePageStatusSchema.optional(),
});
export type UpdateMessagePageInput = z.infer<typeof updateMessagePageInputSchema>;

/** A library row — enough to render the management list without the full body. */
export const messagePageSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  emoji: z.string().nullable(),
  status: messagePageStatusSchema,
  videoType: messagePageVideoTypeSchema,
  videoProvider: messagePageVideoProviderSchema.nullable(),
  hasMessage: z.boolean(),
  hasCta: z.boolean(),
  allowReplies: z.boolean(),
  /** The page's own standalone QR slug (a link with no order recipient), or the
   * first link's slug — what the library previews / offers to download. */
  primarySlug: z.string().nullable(),
  /** How many cards/QRs point at this page. */
  linkCount: z.number().int().nonnegative(),
  /** Views summed across every link (per-card analytics rolled up). */
  totalViews: z.number().int().nonnegative(),
  /** CTA-button clicks summed across every link (Phase 2). */
  totalCtaClicks: z.number().int().nonnegative(),
  /** Total replies received across every link (Phase 2). */
  replyCount: z.number().int().nonnegative(),
  /** Replies not yet marked read — drives the library's "new replies" badge. */
  unreadReplies: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type MessagePageSummary = z.infer<typeof messagePageSummarySchema>;

/** The full page — the summary plus the authored content and computed embed. */
export const messagePageDetailSchema = messagePageSummarySchema.extend({
  /** Server-sanitised HTML. */
  message: z.string().nullable(),
  videoUrl: z.string().nullable(),
  /** The privacy-friendly iframe src derived from `videoUrl` (null unless embed). */
  embedUrl: z.string().nullable(),
  ctaLabel: z.string().nullable(),
  ctaUrl: z.string().nullable(),
  recipientName: z.string().nullable(),
});
export type MessagePageDetail = z.infer<typeof messagePageDetailSchema>;

/** What a recipient posts from the public page (Phase 2). Name is optional; the
 * body is plain text, capped, and required. */
export const submitMessageReplyInputSchema = z.object({
  senderName: z.string().max(MESSAGE_PAGE_LIMITS.replySenderName).nullish(),
  body: z.string().trim().min(1).max(MESSAGE_PAGE_LIMITS.replyBody),
});
export type SubmitMessageReplyInput = z.infer<typeof submitMessageReplyInputSchema>;

/**
 * The engagement funnel (Phase 3, ADR 0132), derived from the per-card links:
 * how many cards were sent, then opened, then had the CTA clicked, then were
 * replied to. `sent`/`viewed`/`clicked`/`replied` count distinct cards (links);
 * the `total*` are the raw event totals across them.
 */
export const messagePageFunnelSchema = z.object({
  sent: z.number().int().nonnegative(),
  viewed: z.number().int().nonnegative(),
  clicked: z.number().int().nonnegative(),
  replied: z.number().int().nonnegative(),
  totalViews: z.number().int().nonnegative(),
  totalClicks: z.number().int().nonnegative(),
  totalReplies: z.number().int().nonnegative(),
});
export type MessagePageFunnel = z.infer<typeof messagePageFunnelSchema>;

/** Per-page insights: its funnel plus when it was first opened. */
export const messagePageInsightsSchema = z.object({
  funnel: messagePageFunnelSchema,
  /** When any of this page's cards was first opened, or null if never. */
  firstViewedAt: z.coerce.date().nullable(),
});
export type MessagePageInsights = z.infer<typeof messagePageInsightsSchema>;

/** Account-wide insights: the funnel summed across every authored page, plus how
 * many pages it spans and the most-viewed few. */
export const messagePageAccountInsightsSchema = z.object({
  pageCount: z.number().int().nonnegative(),
  funnel: messagePageFunnelSchema,
  topPages: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      emoji: z.string().nullable(),
      totalViews: z.number().int().nonnegative(),
    }),
  ),
});
export type MessagePageAccountInsights = z.infer<typeof messagePageAccountInsightsSchema>;

/** One day's engagement totals in a time-series (ADR 0136, Phase 4). `date` is a
 * UTC calendar day, `YYYY-MM-DD`. */
export const messagePageTimeSeriesPointSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  views: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  replies: z.number().int().nonnegative(),
});
export type MessagePageTimeSeriesPoint = z.infer<typeof messagePageTimeSeriesPointSchema>;

/** Daily engagement over the last `days`, derived from the append-only event log.
 * `points` is DENSE — one entry per day in the window, zero-filled where there
 * was no activity — oldest first, so a chart can plot it without gap-filling. */
export const messagePageTimeSeriesSchema = z.object({
  days: z.number().int().positive(),
  points: z.array(messagePageTimeSeriesPointSchema),
});
export type MessagePageTimeSeries = z.infer<typeof messagePageTimeSeriesSchema>;

/** Bounds for the time-series window: 1 day … 1 year, default 30. */
export const MESSAGE_PAGE_TIMESERIES = { minDays: 1, maxDays: 365, defaultDays: 30 } as const;

/** Parse/clamp a raw `days` query param to the allowed window. */
export function resolveTimeSeriesDays(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return MESSAGE_PAGE_TIMESERIES.defaultDays;
  return Math.min(
    MESSAGE_PAGE_TIMESERIES.maxDays,
    Math.max(MESSAGE_PAGE_TIMESERIES.minDays, Math.floor(n)),
  );
}

/** A reply as shown on the dashboard — the message plus which card/recipient it
 * came from (from the link), and its account-level read state. */
export const messagePageReplySchema = z.object({
  id: z.string().uuid(),
  senderName: z.string().nullable(),
  body: z.string(),
  /** The linked contact's name when the reply came from a card sent to them,
   * else null (a standalone-QR reply). */
  fromRecipientName: z.string().nullable(),
  readAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type MessagePageReply = z.infer<typeof messagePageReplySchema>;
