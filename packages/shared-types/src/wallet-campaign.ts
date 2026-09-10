import { z } from "zod";
import { walletCampaignStatusSchema } from "./enums";

/**
 * Per-account credit bounds, in pence.
 *
 * A card is £2.50, so £50 is twenty of them — far beyond a welcome gift, and
 * comfortably inside the range where a slipped decimal is caught rather than
 * paid out. The same shape as the hand-applied adjustment's £1,000 bound, set
 * lower because this one pays out to everybody rather than to one person an
 * operator chose.
 */
export const CAMPAIGN_MIN_AMOUNT_MINOR = 100;
export const CAMPAIGN_MAX_AMOUNT_MINOR = 5_000;

/**
 * Campaign budget bounds, in pence. Required with no default: a per-account
 * amount times an unbounded number of sign-ups is unbounded liability.
 */
export const CAMPAIGN_MIN_BUDGET_MINOR = 100;
export const CAMPAIGN_MAX_BUDGET_MINOR = 1_000_000;

/** A YYYY-MM-DD London calendar day, as an operator types it. */
export const londonDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD");

/**
 * A campaign as the ops surface sees it: its own fields plus what it has spent
 * so far, which is derived from the ledger rather than stored.
 */
export const walletCampaignSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  amountMinor: z.number().int(),
  /** Inclusive London days, converted back from the stored instants. */
  startsOn: londonDaySchema,
  endsOn: londonDaySchema,
  budgetMinor: z.number().int(),
  status: walletCampaignStatusSchema,
  /** Accounts credited so far, counted from the ledger. */
  creditedCount: z.number().int(),
  /** Spent so far, summed from the ledger. */
  creditedMinor: z.number().int(),
  createdAt: z.coerce.date(),
});
export type WalletCampaignView = z.infer<typeof walletCampaignSchema>;

export const walletCampaignListSchema = z.object({ campaigns: z.array(walletCampaignSchema) });
export type WalletCampaignList = z.infer<typeof walletCampaignListSchema>;
