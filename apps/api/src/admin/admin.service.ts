import { Injectable } from "@nestjs/common";
import { BatchOrderStatus, Prisma, SubscriptionStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { Paginated } from "../common/paginated";
import { parsePage, parsePerPage } from "../common/pagination";

/** Order statuses that count as real revenue (a draft is a cart; a cancelled or
 * pending-payment order never collected money). */
export const PAID_STATUSES: BatchOrderStatus[] = [
  BatchOrderStatus.paid,
  BatchOrderStatus.fulfilling,
  BatchOrderStatus.completed,
];

export const ACTIVE_SUB_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.active,
  SubscriptionStatus.trialing,
];

/** A subscription in one of these states, with no active one, means "churned". */
export const CHURNED_SUB_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.canceled,
  SubscriptionStatus.past_due,
];

const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * DAY_MS;
/** An account with no active subscription and no activity for this long is "at risk". */
export const AT_RISK_MS = THIRTY_DAYS_MS;

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** An account's derived health, shown as a pill in the subscribers view. */
export type AccountHealth = "active" | "at_risk" | "churned" | "none";

export interface AdminOverview {
  accounts: { total: number; organisations: number; individuals: number };
  subscribersByPlan: { plan: string; count: number }[];
  activeSubscriptions: number;
  atRiskCount: number;
  orders: { paid: number; last30Days: number };
  revenueMinor: { allTime: number; last30Days: number };
  /** 12 months, oldest → newest, for the revenue chart. */
  monthlyRevenueMinor: { label: string; minor: number }[];
  cardsSent: number;
  /** Signup → first order → cards fulfilled (account counts). */
  funnel: { signedUp: number; placedFirstOrder: number; cardsFulfilled: number };
  /** At-risk accounts to surface, most-stale first. */
  needsAttention: { id: string; name: string; lastActivityDays: number }[];
}

export interface AdminOrderRow {
  id: string;
  orderNumber: number;
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
  health: AccountHealth;
  createdAt: Date;
  lastActivityAt: Date;
  orderCount: number;
  cardsSent: number;
  totalSpentMinor: number;
  recipientCount: number;
  hasStripeCustomer: boolean;
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Dashboard overview
  // ---------------------------------------------------------------------------

  async overview(): Promise<AdminOverview> {
    const now = Date.now();
    const since30 = new Date(now - THIRTY_DAYS_MS);
    const since12mo = startOfMonthsAgo(11);
    const paidWhere = { status: { in: PAID_STATUSES } };

    const [accounts, subs, allTime, last30, cardsSent, recentPaid, placedFirst, fulfilled] =
      await Promise.all([
        this.prisma.account.findMany({
          select: { id: true, name: true, type: true, planId: true, createdAt: true },
        }),
        this.prisma.subscription.findMany({ select: { accountId: true, status: true } }),
        this.prisma.batchOrder.aggregate({
          where: paidWhere,
          _count: true,
          _sum: { totalMinor: true },
        }),
        this.prisma.batchOrder.aggregate({
          where: { ...paidWhere, createdAt: { gte: since30 } },
          _count: true,
          _sum: { totalMinor: true },
        }),
        this.prisma.orderRecipient.count({ where: { batchOrder: paidWhere } }),
        // Paid orders in the last 12 months → revenue chart + per-account last order.
        this.prisma.batchOrder.findMany({
          where: { ...paidWhere, createdAt: { gte: since12mo } },
          select: { accountId: true, createdAt: true, totalMinor: true },
        }),
        this.prisma.batchOrder.groupBy({ by: ["accountId"], where: paidWhere }),
        this.prisma.batchOrder.groupBy({
          by: ["accountId"],
          where: { status: BatchOrderStatus.completed },
        }),
      ]);

    // Accounts breakdown.
    const organisations = accounts.filter((a) => a.type === "organisation").length;
    const individuals = accounts.filter((a) => a.type === "individual").length;
    const byPlan = new Map<string, number>();
    for (const account of accounts) {
      const plan = account.planId ?? "free";
      byPlan.set(plan, (byPlan.get(plan) ?? 0) + 1);
    }

    // Subscriptions.
    const activeSet = new Set(
      subs.filter((s) => ACTIVE_SUB_STATUSES.includes(s.status)).map((s) => s.accountId),
    );

    // Last paid-order date per account (within the 12-month window is enough:
    // anything older already clears the at-risk threshold).
    const lastOrderByAccount = new Map<string, number>();
    const monthBuckets = buildMonthBuckets(11);
    for (const order of recentPaid) {
      const t = order.createdAt.getTime();
      const prev = lastOrderByAccount.get(order.accountId) ?? 0;
      if (t > prev) lastOrderByAccount.set(order.accountId, t);
      const key = monthKey(order.createdAt);
      const bucket = monthBuckets.get(key);
      if (bucket) bucket.minor += order.totalMinor;
    }

    // At-risk: no active subscription, and no activity for 30+ days.
    const atRisk: { id: string; name: string; lastActivityDays: number }[] = [];
    for (const account of accounts) {
      if (activeSet.has(account.id)) continue;
      const lastActivity = lastOrderByAccount.get(account.id) ?? account.createdAt.getTime();
      const idleMs = now - lastActivity;
      if (idleMs >= AT_RISK_MS) {
        atRisk.push({
          id: account.id,
          name: account.name,
          lastActivityDays: Math.floor(idleMs / DAY_MS),
        });
      }
    }
    atRisk.sort((a, b) => b.lastActivityDays - a.lastActivityDays);

    return {
      accounts: { total: accounts.length, organisations, individuals },
      subscribersByPlan: [...byPlan.entries()]
        .map(([plan, count]) => ({ plan, count }))
        .sort((a, b) => b.count - a.count),
      activeSubscriptions: activeSet.size,
      atRiskCount: atRisk.length,
      orders: { paid: allTime._count, last30Days: last30._count },
      revenueMinor: {
        allTime: allTime._sum.totalMinor ?? 0,
        last30Days: last30._sum.totalMinor ?? 0,
      },
      monthlyRevenueMinor: [...monthBuckets.values()].map((b) => ({ label: b.label, minor: b.minor })),
      cardsSent,
      funnel: {
        signedUp: accounts.length,
        placedFirstOrder: placedFirst.length,
        cardsFulfilled: fulfilled.length,
      },
      needsAttention: atRisk.slice(0, 6),
    };
  }

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  async listOrders(query: {
    status?: BatchOrderStatus;
    search?: string;
    page?: string;
    perPage?: string;
  }): Promise<Paginated<AdminOrderRow>> {
    const page = parsePage(query.page);
    const perPage = parsePerPage(query.perPage, 50);
    const search = query.search?.trim();

    const filters: Prisma.BatchOrderWhereInput[] = [
      query.status ? { status: query.status } : { status: { not: BatchOrderStatus.draft } },
    ];
    if (search) {
      const or: Prisma.BatchOrderWhereInput[] = [
        { account: { name: { contains: search, mode: "insensitive" } } },
      ];
      // "ORD-1035" or "1035" → match the order number.
      const digits = Number(search.replace(/[^0-9]/g, ""));
      if (Number.isInteger(digits) && digits > 0) or.push({ orderNumber: digits });
      filters.push({ OR: or });
    }
    const where: Prisma.BatchOrderWhereInput = { AND: filters };

    const [rows, total] = await Promise.all([
      this.prisma.batchOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          orderNumber: true,
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
        orderNumber: row.orderNumber,
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

  // ---------------------------------------------------------------------------
  // Subscribers
  // ---------------------------------------------------------------------------

  async listSubscribers(query: {
    search?: string;
    plan?: string;
    health?: AccountHealth;
    page?: string;
    perPage?: string;
  }): Promise<Paginated<AdminSubscriberRow>> {
    const page = parsePage(query.page);
    const perPage = parsePerPage(query.perPage, 50);
    const search = query.search?.trim();

    // Search + plan filter run in SQL (real columns). Health is derived, so it's
    // filtered after computing — the admin account count is modest.
    const where: Prisma.AccountWhereInput = {
      ...(search && { name: { contains: search, mode: "insensitive" } }),
      ...(query.plan && { planId: query.plan === "free" ? null : query.plan }),
    };

    const accounts = await this.prisma.account.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        type: true,
        planId: true,
        createdAt: true,
        stripeCustomerId: true,
      },
    });
    const ids = accounts.map((a) => a.id);

    const [orders, subs, recipientCounts] = await Promise.all([
      ids.length === 0
        ? []
        : this.prisma.batchOrder.findMany({
            where: { accountId: { in: ids }, status: { in: PAID_STATUSES } },
            select: {
              accountId: true,
              createdAt: true,
              totalMinor: true,
              _count: { select: { orderRecipients: true } },
            },
          }),
      ids.length === 0
        ? []
        : this.prisma.subscription.findMany({
            where: { accountId: { in: ids } },
            select: { accountId: true, status: true },
          }),
      // Contacts on file — a headline engagement signal, so it earns a list column.
      ids.length === 0
        ? []
        : this.prisma.recipient.groupBy({
            by: ["accountId"],
            where: { accountId: { in: ids } },
            _count: true,
          }),
    ]);
    const recipientCountByAccount = new Map(
      recipientCounts.map((r) => [r.accountId, r._count]),
    );

    const stats = new Map<
      string,
      { orderCount: number; cardsSent: number; totalSpentMinor: number; lastOrderAt: number }
    >();
    for (const order of orders) {
      const current = stats.get(order.accountId) ?? {
        orderCount: 0,
        cardsSent: 0,
        totalSpentMinor: 0,
        lastOrderAt: 0,
      };
      current.orderCount += 1;
      current.cardsSent += order._count.orderRecipients;
      current.totalSpentMinor += order.totalMinor;
      current.lastOrderAt = Math.max(current.lastOrderAt, order.createdAt.getTime());
      stats.set(order.accountId, current);
    }

    const activeSet = new Set<string>();
    const churnedSet = new Set<string>();
    for (const sub of subs) {
      if (ACTIVE_SUB_STATUSES.includes(sub.status)) activeSet.add(sub.accountId);
      else if (CHURNED_SUB_STATUSES.includes(sub.status)) churnedSet.add(sub.accountId);
    }

    const now = Date.now();
    const all: AdminSubscriberRow[] = accounts.map((account) => {
      const stat = stats.get(account.id);
      const lastActivity = stat?.lastOrderAt || account.createdAt.getTime();
      const health = accountHealth({
        active: activeSet.has(account.id),
        churned: churnedSet.has(account.id),
        idleMs: now - lastActivity,
      });
      return {
        id: account.id,
        name: account.name,
        type: account.type,
        plan: account.planId ?? "free",
        health,
        createdAt: account.createdAt,
        lastActivityAt: new Date(lastActivity),
        orderCount: stat?.orderCount ?? 0,
        cardsSent: stat?.cardsSent ?? 0,
        totalSpentMinor: stat?.totalSpentMinor ?? 0,
        recipientCount: recipientCountByAccount.get(account.id) ?? 0,
        hasStripeCustomer: account.stripeCustomerId !== null,
      };
    });

    const filtered = query.health ? all.filter((row) => row.health === query.health) : all;
    const start = (page - 1) * perPage;
    return {
      items: filtered.slice(start, start + perPage),
      total: filtered.length,
      page,
      perPage,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function accountHealth(input: {
  active: boolean;
  churned: boolean;
  idleMs: number;
}): AccountHealth {
  if (input.active) return "active";
  if (input.churned) return "churned";
  if (input.idleMs >= AT_RISK_MS) return "at_risk";
  return "none";
}

/** First day of the month, `n` months before the current one. */
function startOfMonthsAgo(n: number): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
}

/** 12 ordered month buckets (oldest → current) keyed by year-month. */
function buildMonthBuckets(monthsBack: number): Map<string, { label: string; minor: number }> {
  const buckets = new Map<string, { label: string; minor: number }>();
  const now = new Date();
  for (let i = monthsBack; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.set(`${d.getUTCFullYear()}-${d.getUTCMonth()}`, {
      label: MONTH_LABELS[d.getUTCMonth()]!,
      minor: 0,
    });
  }
  return buckets;
}
