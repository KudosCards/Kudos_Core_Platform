import { z } from "zod";
import { walletLedgerEntrySchema } from "./billing";

/**
 * Current balance plus the most recent ledger entries — the GET /wallet payload.
 * The balance is never stored on its own: it's the SUM of every ledger entry's
 * amountMinor (topups positive, charges negative), so it can't drift from the
 * ledger. See docs/adr/0012-wallet.md.
 */
export const autoTopUpSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Charge when the balance falls below this, in pence. */
  thresholdMinor: z.number().int(),
  /** How much to add each time, in pence. */
  amountMinor: z.number().int(),
  /** Set when a charge failed hard enough that we stopped trying. */
  pausedAt: z.coerce.date().nullable(),
  /** The pause reason as a code (see the API's wallet/auto-top-up.ts). The
   * wording lives in the web app, the way inbox copy does. */
  pausedReason: z.string().nullable(),
});
export type AutoTopUpSettings = z.infer<typeof autoTopUpSettingsSchema>;

export const walletSummarySchema = z.object({
  balanceMinor: z.number().int(),
  currency: z.string(),
  entries: z.array(walletLedgerEntrySchema),
  autoTopUp: autoTopUpSettingsSchema,
});
export type WalletSummary = z.infer<typeof walletSummarySchema>;

/** What a customer may add by hand in one go: £1 to £1,000. Named because the
 * automatic top-up's ceiling is defined against it — an unattended charge must
 * never exceed what the same person could authorise themselves. */
export const TOP_UP_MIN_MINOR = 100;
export const TOP_UP_MAX_MINOR = 100_000;

/** Bounds the API enforces on the standing instruction, mirrored here so the
 * form can refuse a value before a round-trip does. See ADR 0255. */
export const AUTO_TOP_UP_THRESHOLD_MIN_MINOR = 100;
export const AUTO_TOP_UP_THRESHOLD_MAX_MINOR = 20_000;
export const AUTO_TOP_UP_AMOUNT_MIN_MINOR = 500;
export const AUTO_TOP_UP_AMOUNT_MAX_MINOR = TOP_UP_MAX_MINOR;

/** PATCH /wallet/auto-top-up body. */
export const autoTopUpInputSchema = z.object({
  enabled: z.boolean(),
  thresholdMinor: z
    .number()
    .int()
    .min(AUTO_TOP_UP_THRESHOLD_MIN_MINOR)
    .max(AUTO_TOP_UP_THRESHOLD_MAX_MINOR),
  amountMinor: z.number().int().min(AUTO_TOP_UP_AMOUNT_MIN_MINOR).max(AUTO_TOP_UP_AMOUNT_MAX_MINOR),
});
export type AutoTopUpInput = z.infer<typeof autoTopUpInputSchema>;

/** POST /wallet/top-up body: amount to add, in pence (£1–£1,000). */
export const walletTopUpInputSchema = z.object({
  amountMinor: z.number().int().min(TOP_UP_MIN_MINOR).max(TOP_UP_MAX_MINOR),
});
export type WalletTopUpInput = z.infer<typeof walletTopUpInputSchema>;
