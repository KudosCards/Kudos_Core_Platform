import { Injectable, NotFoundException } from "@nestjs/common";
import { BatchOrderStatus, Prisma, SubscriptionStatus } from "@prisma/client";
import type { AdminOrderDetail, OrderFulfillmentProgress } from "@kudos/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import type { Paginated } from "../common/paginated";
import { parsePage, parsePerPage } from "../common/pagination";

/** Largest value a Postgres int4 column (e.g. BatchOrder.orderNumber) can hold —
 * an upper bound for numeric search terms so they can't overflow the column. */
const MAX_INT4 = 2_147_483_647;

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
  /** Real fulfilment progress (job-status counts + Click & Drop tally), so the
   * list shows "340/2,000 posted" not a status label. See ADR 0109. */
  progress: OrderFulfillmentProgress;
}

/** Raw row from the per-order fulfilment-progress aggregate (snake_case as the
 * SQL returns it). */
interface RawProgressRow {
  orderId: string;
  total: number;
  pending: number;
  in_progress: number;
  printed: number;
  posted: number;
  delivered: number;
  returned_to_sender: number;
  failed: number;
  imported: number;
  import_errors: number;
}

/** A zeroed progress record — the default for an order with no fulfilment jobs
 * yet (not paid), and the accumulator base for the detail view. */
function emptyProgress(): OrderFulfillmentProgress {
  return {
    total: 0,
    pending: 0,
    inProgress: 0,
    printed: 0,
    posted: 0,
    delivered: 0,
    returnedToSender: 0,
    failed: 0,
    imported: 0,
    importErrors: 0,
  };
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
      // "ORD-1035" or "1035" → match the order number. Bounded to the int4 range
      // so a long numeric search (e.g. a pasted card number) can't overflow the
      // orderNumber column and 500 the request.
      const digits = Number(search.replace(/[^0-9]/g, ""));
      if (Number.isInteger(digits) && digits > 0 && digits <= MAX_INT4) {
        or.push({ orderNumber: digits });
      }
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

    // Real fulfilment progress for just this page's orders, in one aggregate.
    const progressByOrder = await this.progressForOrders(rows.map((row) => row.id));

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
        progress: progressByOrder.get(row.id) ?? emptyProgress(),
      })),
      total,
      page,
      perPage,
    };
  }

  /**
   * Fulfilment-job status counts + Click & Drop tally for a set of orders, in
   * one round-trip. FulfillmentJob's order lives one hop away (via
   * OrderRecipient), which Prisma's `groupBy` can't group across — so this is a
   * filtered aggregate over the join, scoped to the page's order ids. Orders
   * with no jobs yet (unpaid) simply don't appear and default to all-zeros.
   */
  private async progressForOrders(
    orderIds: string[],
  ): Promise<Map<string, OrderFulfillmentProgress>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<RawProgressRow[]>(Prisma.sql`
      SELECT
        r.batch_order_id AS "orderId",
        count(*)::int AS total,
        count(*) FILTER (WHERE fj.status::text = 'pending')::int AS pending,
        count(*) FILTER (WHERE fj.status::text = 'in_progress')::int AS in_progress,
        count(*) FILTER (WHERE fj.status::text = 'printed')::int AS printed,
        count(*) FILTER (WHERE fj.status::text = 'posted')::int AS posted,
        count(*) FILTER (WHERE fj.status::text = 'delivered')::int AS delivered,
        count(*) FILTER (WHERE fj.status::text = 'returned_to_sender')::int AS returned_to_sender,
        count(*) FILTER (WHERE fj.status::text = 'failed')::int AS failed,
        count(*) FILTER (WHERE fj.click_and_drop_order_id IS NOT NULL)::int AS imported,
        count(*) FILTER (WHERE fj.click_and_drop_error IS NOT NULL)::int AS import_errors
      FROM fulfillment_jobs fj
      JOIN order_recipients r ON r.id = fj.order_recipient_id
      WHERE r.batch_order_id IN (${Prisma.join(orderIds)})
      GROUP BY r.batch_order_id
    `);
    const map = new Map<string, OrderFulfillmentProgress>();
    for (const row of rows) {
      map.set(row.orderId, {
        total: row.total,
        pending: row.pending,
        inProgress: row.in_progress,
        printed: row.printed,
        posted: row.posted,
        delivered: row.delivered,
        returnedToSender: row.returned_to_sender,
        failed: row.failed,
        imported: row.imported,
        importErrors: row.import_errors,
      });
    }
    return map;
  }

  /**
   * One order worked as a unit: header (with the VAT-inclusive money breakdown),
   * real fulfilment progress, and every card line. Deliberately name + occasion
   * + postage + status per line — never the street address, which stays behind
   * the audited fulfilment export (mirroring the queue's data minimisation).
   */
  async getOrder(id: string): Promise<AdminOrderDetail> {
    const order = await this.prisma.batchOrder.findUnique({
      where: { id },
      select: {
        id: true,
        orderNumber: true,
        accountId: true,
        status: true,
        currency: true,
        subtotalMinor: true,
        postageMinor: true,
        totalMinor: true,
        paymentMethod: true,
        receiptUrl: true,
        receiptPdfUrl: true,
        createdAt: true,
        updatedAt: true,
        account: { select: { name: true } },
        orderRecipients: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            postageClass: true,
            dispatchOption: true,
            recipient: { select: { firstName: true, lastName: true } },
            savedDesign: { select: { name: true } },
            occasion: { select: { type: true, occasionDate: true } },
            fulfillmentJob: {
              select: {
                id: true,
                status: true,
                dueDate: true,
                trackingReference: true,
                clickAndDropOrderId: true,
                clickAndDropError: true,
              },
            },
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException("Order not found");
    }

    const lines = order.orderRecipients.map((r) => ({
      orderRecipientId: r.id,
      jobId: r.fulfillmentJob?.id ?? null,
      recipientName: `${r.recipient.firstName} ${r.recipient.lastName}`.trim(),
      designName: r.savedDesign.name,
      postageClass: r.postageClass,
      dispatchOption: r.dispatchOption,
      occasionType: r.occasion?.type ?? null,
      occasionDate: r.occasion?.occasionDate ?? null,
      dueDate: r.fulfillmentJob?.dueDate ?? null,
      jobStatus: r.fulfillmentJob?.status ?? null,
      trackingReference: r.fulfillmentJob?.trackingReference ?? null,
      clickAndDropImported: r.fulfillmentJob?.clickAndDropOrderId != null,
      clickAndDropError: r.fulfillmentJob?.clickAndDropError ?? null,
    }));

    // Progress from the lines we already have — no extra round-trip.
    const progress = emptyProgress();
    for (const line of lines) {
      if (!line.jobStatus) continue;
      progress.total += 1;
      if (line.jobStatus === "pending") progress.pending += 1;
      else if (line.jobStatus === "in_progress") progress.inProgress += 1;
      else if (line.jobStatus === "printed") progress.printed += 1;
      else if (line.jobStatus === "posted") progress.posted += 1;
      else if (line.jobStatus === "delivered") progress.delivered += 1;
      else if (line.jobStatus === "returned_to_sender") progress.returnedToSender += 1;
      else if (line.jobStatus === "failed") progress.failed += 1;
      if (line.clickAndDropImported) progress.imported += 1;
      if (line.clickAndDropError) progress.importErrors += 1;
    }

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      accountId: order.accountId,
      accountName: order.account.name,
      status: order.status,
      currency: order.currency,
      subtotalMinor: order.subtotalMinor,
      postageMinor: order.postageMinor,
      totalMinor: order.totalMinor,
      paymentMethod: order.paymentMethod,
      receiptUrl: order.receiptUrl,
      receiptPdfUrl: order.receiptPdfUrl,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      cardCount: order.orderRecipients.length,
      progress,
      lines,
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
