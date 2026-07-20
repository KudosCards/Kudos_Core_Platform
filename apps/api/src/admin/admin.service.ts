import { Injectable } from "@nestjs/common";
import { BatchOrderStatus, Prisma, SubscriptionStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { Paginated } from "../common/paginated";
import { parsePage, parsePerPage } from "../common/pagination";

/** Order statuses that count as real revenue (a draft is a cart; a cancelled or
 * pending-payment order never collected money). */
const PAID_STATUSES: BatchOrderStatus[] = [
  BatchOrderStatus.paid,
  BatchOrderStatus.fulfilling,
  BatchOrderStatus.completed,
];

const ACTIVE_SUB_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.active,
  SubscriptionStatus.trialing,
];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Platform-wide KPI snapshot for the super-admin dashboard. All money in minor
 * units (pence). */
export interface AdminOverview {
  accounts: { total: number; organisations: number; individuals: number };
  subscribersByPlan: { plan: string; count: number }[];
  activeSubscriptions: number;
  orders: { paid: number; last30Days: number };
  revenueMinor: { allTime: number; last30Days: number };
  cardsSent: number;
}

export interface AdminOrderRow {
  id: string;
  accountId: string;
  accountName: string;
  status: BatchOrderStatus;
  totalMinor: number;
  currency: string;
  cardCount: number;
  paymentMethod: string | null;
  createdAt: Date;
}

export interface AdminSubscriberRow {
  id: string;
  name: string;
  type: string;
  plan: string;
  createdAt: Date;
  orderCount: number;
  cardsSent: number;
  totalSpentMinor: number;
  hasActiveSubscription: boolean;
  hasStripeCustomer: boolean;
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(): Promise<AdminOverview> {
    const since = new Date(Date.now() - THIRTY_DAYS_MS);
    const paidWhere = { status: { in: PAID_STATUSES } };

    // Six queries (down from ten): count+sum are folded into one aggregate per
    // window, and the account breakdown comes from a single groupBy. Fewer
    // round-trips matters under a small pgbouncer pool, where "parallel" queries
    // otherwise queue behind each other.
    const [byType, byPlan, activeSubscriptions, allTime, last30, cardsSent] = await Promise.all([
      this.prisma.account.groupBy({ by: ["type"], _count: { _all: true } }),
      this.prisma.account.groupBy({ by: ["planId"], _count: { _all: true } }),
      this.prisma.subscription.count({ where: { status: { in: ACTIVE_SUB_STATUSES } } }),
      this.prisma.batchOrder.aggregate({
        where: paidWhere,
        _count: true,
        _sum: { totalMinor: true },
      }),
      this.prisma.batchOrder.aggregate({
        where: { ...paidWhere, createdAt: { gte: since } },
        _count: true,
        _sum: { totalMinor: true },
      }),
      this.prisma.orderRecipient.count({ where: { batchOrder: paidWhere } }),
    ]);

    const organisations = byType.find((row) => row.type === "organisation")?._count._all ?? 0;
    const individuals = byType.find((row) => row.type === "individual")?._count._all ?? 0;

    return {
      accounts: { total: organisations + individuals, organisations, individuals },
      subscribersByPlan: byPlan
        .map((row) => ({ plan: row.planId ?? "free", count: row._count._all }))
        .sort((a, b) => b.count - a.count),
      activeSubscriptions,
      orders: { paid: allTime._count, last30Days: last30._count },
      revenueMinor: {
        allTime: allTime._sum.totalMinor ?? 0,
        last30Days: last30._sum.totalMinor ?? 0,
      },
      cardsSent,
    };
  }

  async listOrders(query: {
    status?: BatchOrderStatus;
    page?: string;
    perPage?: string;
  }): Promise<Paginated<AdminOrderRow>> {
    const page = parsePage(query.page);
    const perPage = parsePerPage(query.perPage, 50);
    // Default view hides drafts (they're carts, not orders); a status filter
    // shows exactly that status.
    const where: Prisma.BatchOrderWhereInput = query.status
      ? { status: query.status }
      : { status: { not: BatchOrderStatus.draft } };

    const [rows, total] = await Promise.all([
      this.prisma.batchOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          accountId: true,
          status: true,
          totalMinor: true,
          currency: true,
          paymentMethod: true,
          createdAt: true,
          account: { select: { name: true } },
          _count: { select: { orderRecipients: true } },
        },
      }),
      this.prisma.batchOrder.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        accountId: row.accountId,
        accountName: row.account.name,
        status: row.status,
        totalMinor: row.totalMinor,
        currency: row.currency,
        cardCount: row._count.orderRecipients,
        paymentMethod: row.paymentMethod,
        createdAt: row.createdAt,
      })),
      total,
      page,
      perPage,
    };
  }

  async listSubscribers(query: {
    page?: string;
    perPage?: string;
  }): Promise<Paginated<AdminSubscriberRow>> {
    const page = parsePage(query.page);
    const perPage = parsePerPage(query.perPage, 50);

    const [accounts, total] = await Promise.all([
      this.prisma.account.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          name: true,
          type: true,
          planId: true,
          createdAt: true,
          stripeCustomerId: true,
        },
      }),
      this.prisma.account.count(),
    ]);

    const ids = accounts.map((account) => account.id);

    // Aggregate paid orders + cards + spend per account for this page in one
    // query, then fold in JS (one row per order, bounded by the page size).
    const orders =
      ids.length === 0
        ? []
        : await this.prisma.batchOrder.findMany({
            where: { accountId: { in: ids }, status: { in: PAID_STATUSES } },
            select: {
              accountId: true,
              totalMinor: true,
              _count: { select: { orderRecipients: true } },
            },
          });

    const stats = new Map<string, { orderCount: number; cardsSent: number; totalSpentMinor: number }>();
    for (const order of orders) {
      const current = stats.get(order.accountId) ?? {
        orderCount: 0,
        cardsSent: 0,
        totalSpentMinor: 0,
      };
      current.orderCount += 1;
      current.cardsSent += order._count.orderRecipients;
      current.totalSpentMinor += order.totalMinor;
      stats.set(order.accountId, current);
    }

    const activeSubs =
      ids.length === 0
        ? []
        : await this.prisma.subscription.findMany({
            where: { accountId: { in: ids }, status: { in: ACTIVE_SUB_STATUSES } },
            select: { accountId: true },
          });
    const activeSet = new Set(activeSubs.map((sub) => sub.accountId));

    return {
      items: accounts.map((account) => {
        const stat = stats.get(account.id);
        return {
          id: account.id,
          name: account.name,
          type: account.type,
          plan: account.planId ?? "free",
          createdAt: account.createdAt,
          orderCount: stat?.orderCount ?? 0,
          cardsSent: stat?.cardsSent ?? 0,
          totalSpentMinor: stat?.totalSpentMinor ?? 0,
          hasActiveSubscription: activeSet.has(account.id),
          hasStripeCustomer: account.stripeCustomerId !== null,
        };
      }),
      total,
      page,
      perPage,
    };
  }
}
