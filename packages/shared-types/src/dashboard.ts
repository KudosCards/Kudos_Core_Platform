import { z } from "zod";

/**
 * The account home-screen summary — GET /accounts/me/summary. A handful of
 * cheap counts + the wallet balance, so the dashboard can show "what needs my
 * attention" without the client fanning out to five list endpoints.
 */
export const dashboardSummarySchema = z.object({
  /** Active recipients on the account. */
  recipientCount: z.number().int().nonnegative(),
  /** Wallet balance in pence (the same figure as GET /wallet). */
  walletBalanceMinor: z.number().int(),
  /** Occasions waiting in the approvals queue. */
  pendingApprovals: z.number().int().nonnegative(),
  /** Occasions whose date falls in the current calendar month. */
  occasionsThisMonth: z.number().int().nonnegative(),
  /** Orders not yet finished: draft, pending payment, paid, or in production. */
  activeOrders: z.number().int().nonnegative(),
  /** Orders that have completed fulfilment. */
  completedOrders: z.number().int().nonnegative(),
  /** True once at least one occasion exists — i.e. birthdays are lined up on the
   * calendar. Drives the dashboard "get started" checklist. */
  hasOccasions: z.boolean(),
  /** True once the account has paid for its first order (status paid or beyond) —
   * the "completed their first purchase" milestone that dismisses onboarding. */
  firstOrderPlaced: z.boolean(),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
