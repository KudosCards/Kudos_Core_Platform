import { z } from "zod";
import { walletLedgerEntrySchema } from "./billing";

/**
 * Current balance plus the most recent ledger entries — the GET /wallet payload.
 * The balance is never stored on its own: it's the SUM of every ledger entry's
 * amountMinor (topups positive, charges negative), so it can't drift from the
 * ledger. See docs/adr/0012-wallet.md.
 */
export const walletSummarySchema = z.object({
  balanceMinor: z.number().int(),
  currency: z.string(),
  entries: z.array(walletLedgerEntrySchema),
});
export type WalletSummary = z.infer<typeof walletSummarySchema>;

/** POST /wallet/top-up body: amount to add, in pence (£1–£1,000). */
export const walletTopUpInputSchema = z.object({
  amountMinor: z.number().int().min(100).max(100_000),
});
export type WalletTopUpInput = z.infer<typeof walletTopUpInputSchema>;
