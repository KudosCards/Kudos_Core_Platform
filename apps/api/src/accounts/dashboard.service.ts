import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface DashboardSummary {
  recipientCount: number;
  walletBalanceMinor: number;
  pendingApprovals: number;
  occasionsThisMonth: number;
  activeOrders: number;
  completedOrders: number;
}

/** Orders still moving through the pipeline — anything not completed or cancelled. */
const ACTIVE_ORDER_STATUSES = ["draft", "pending_payment", "paid", "fulfilling"] as const;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(accountId: string): Promise<DashboardSummary> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    // One round-trip of independent counts, not six awaited in series.
    const [recipientCount, walletSum, pendingApprovals, occasionsThisMonth, activeOrders, completedOrders] =
      await Promise.all([
        this.prisma.recipient.count({ where: { accountId, status: "active" } }),
        // Balance = SUM of the wallet ledger — the same invariant WalletService
        // owns (see docs/adr/0012-wallet.md); read-only here.
        this.prisma.walletLedgerEntry.aggregate({
          where: { accountId },
          _sum: { amountMinor: true },
        }),
        this.prisma.occasion.count({ where: { accountId, status: "pending_approval" } }),
        this.prisma.occasion.count({
          where: { accountId, occasionDate: { gte: monthStart, lt: nextMonthStart } },
        }),
        this.prisma.batchOrder.count({
          where: { accountId, status: { in: [...ACTIVE_ORDER_STATUSES] } },
        }),
        this.prisma.batchOrder.count({ where: { accountId, status: "completed" } }),
      ]);

    return {
      recipientCount,
      walletBalanceMinor: walletSum._sum.amountMinor ?? 0,
      pendingApprovals,
      occasionsThisMonth,
      activeOrders,
      completedOrders,
    };
  }
}
