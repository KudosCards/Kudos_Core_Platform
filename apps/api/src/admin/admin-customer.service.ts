import { Injectable, NotFoundException } from "@nestjs/common";
import { BatchOrderStatus, OccasionStatus, RecipientStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { Customer360, EngagementLevel } from "@kudos/shared-types";
import {
  ACTIVE_SUB_STATUSES,
  CHURNED_SUB_STATUSES,
  PAID_STATUSES,
  accountHealth,
} from "./admin.service";

/** Return-case statuses that are still open (need someone to act). */
const OPEN_RETURN_STATUSES = ["awaiting_address", "awaiting_resend"] as const;

/**
 * The super-admin "Customer 360": one account's full profile and engagement,
 * aggregated across every surface (contacts, occasions, integrations, wallet,
 * team, orders, returns). One account at a time, so a fan of parallel queries
 * is fine — this is a detail page, not a per-row list computation.
 * See docs/adr/0041-admin-customer-360.md.
 */
@Injectable()
export class AdminCustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async getCustomer(accountId: string): Promise<Customer360> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException("Customer not found");
    }

    const paidWhere = { accountId, status: { in: PAID_STATUSES } };

    const [
      memberships,
      pendingInvites,
      entitlement,
      recipientsByStatus,
      recipientsBySource,
      needsAddress,
      listCount,
      scheduledOccasions,
      autoSendOccasions,
      upcomingOccasions,
      lastRecipientUpdate,
      crmConnections,
      apiKeys,
      walletEntry,
      savedDesignCount,
      messageStats,
      paidAgg,
      cardsSent,
      ordersByStatus,
      recentOrders,
      subscription,
      subsForHealth,
      returnsTotal,
      returnsOpen,
    ] = await Promise.all([
      this.prisma.membership.findMany({
        where: { accountId },
        select: { email: true, role: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.invite.count({ where: { accountId, status: "pending" } }),
      this.prisma.planEntitlement.findUnique({
        where: { planId: account.planId ?? "free" },
        select: { includedSeats: true },
      }),
      this.prisma.recipient.groupBy({ by: ["status"], where: { accountId }, _count: true }),
      this.prisma.recipient.groupBy({ by: ["source"], where: { accountId }, _count: true }),
      this.prisma.recipient.count({ where: { accountId, addressVerificationRequired: true } }),
      this.prisma.recipientList.count({ where: { accountId } }),
      this.prisma.occasion.count({ where: { accountId, status: OccasionStatus.scheduled } }),
      this.prisma.occasion.count({
        where: { accountId, dispatchOption: "auto_send", status: { not: OccasionStatus.skipped } },
      }),
      this.prisma.occasion.findMany({
        where: { accountId, status: OccasionStatus.scheduled, occasionDate: { gte: startOfToday() } },
        orderBy: { occasionDate: "asc" },
        take: 5,
        select: { title: true, type: true, occasionDate: true, dispatchDate: true },
      }),
      this.prisma.recipient.findFirst({
        where: { accountId },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
      this.prisma.crmConnection.findMany({
        where: { accountId },
        select: { provider: true, syncEnabled: true, lastSyncedAt: true, lastSyncStatus: true },
      }),
      this.prisma.accountApiKey.findMany({
        where: { accountId },
        select: { label: true, prefix: true, lastUsedAt: true, revokedAt: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.walletLedgerEntry.findFirst({
        where: { accountId },
        orderBy: { createdAt: "desc" },
        select: { balanceAfterMinor: true, createdAt: true },
      }),
      this.prisma.savedDesign.count({ where: { accountId } }),
      this.prisma.messagePage.aggregate({
        where: { orderRecipient: { batchOrder: { accountId } } },
        _count: true,
        _sum: { viewCount: true },
      }),
      this.prisma.batchOrder.aggregate({
        where: paidWhere,
        _count: true,
        _sum: { totalMinor: true },
      }),
      this.prisma.orderRecipient.count({ where: { batchOrder: paidWhere } }),
      this.prisma.batchOrder.groupBy({
        by: ["status"],
        where: { accountId, status: { not: BatchOrderStatus.draft } },
        _count: true,
      }),
      this.prisma.batchOrder.findMany({
        where: { accountId, status: { not: BatchOrderStatus.draft } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalMinor: true,
          currency: true,
          paymentMethod: true,
          createdAt: true,
          _count: { select: { orderRecipients: true } },
        },
      }),
      this.prisma.subscription.findFirst({
        where: { accountId },
        orderBy: { createdAt: "desc" },
        select: { status: true, planId: true, currentPeriodEnd: true },
      }),
      this.prisma.subscription.findMany({ where: { accountId }, select: { status: true } }),
      this.prisma.returnCase.count({ where: { accountId } }),
      this.prisma.returnCase.count({
        where: { accountId, status: { in: [...OPEN_RETURN_STATUSES] } },
      }),
    ]);

    // Contacts breakdown.
    const statusCount = (s: RecipientStatus) =>
      recipientsByStatus.find((r) => r.status === s)?._count ?? 0;
    const contactsTotal = recipientsByStatus.reduce((sum, r) => sum + r._count, 0);
    const bySource = recipientsBySource
      .map((r) => ({ source: r.source, count: r._count }))
      .sort((a, b) => b.count - a.count);

    // Subscription health (mirrors the subscribers list).
    const active = subsForHealth.some((s) => ACTIVE_SUB_STATUSES.includes(s.status));
    const churned = subsForHealth.some((s) => CHURNED_SUB_STATUSES.includes(s.status));

    // Last activity across every meaningful signal, not just orders.
    const lastActivityAt = new Date(
      Math.max(
        account.createdAt.getTime(),
        recentOrders[0]?.createdAt.getTime() ?? 0,
        lastRecipientUpdate?.updatedAt.getTime() ?? 0,
        walletEntry?.createdAt.getTime() ?? 0,
        ...crmConnections.map((c) => c.lastSyncedAt?.getTime() ?? 0),
        ...apiKeys.map((k) => k.lastUsedAt?.getTime() ?? 0),
      ),
    );

    const health = accountHealth({
      active,
      churned,
      idleMs: Date.now() - lastActivityAt.getTime(),
    });

    const signals = {
      hasContacts: contactsTotal > 0,
      hasOccasions: scheduledOccasions > 0 || autoSendOccasions > 0,
      hasIntegration: crmConnections.length > 0 || apiKeys.some((k) => !k.revokedAt),
      hasOrder: paidAgg._count > 0,
      hasTeam: memberships.length > 1,
    };

    return {
      id: account.id,
      name: account.name,
      type: account.type,
      plan: account.planId ?? "free",
      contactEmail: account.contactEmail,
      hasStripeCustomer: account.stripeCustomerId !== null,
      reminderEmailsEnabled: account.reminderEmailsEnabled,
      createdAt: account.createdAt,
      lastActivityAt,
      health,
      engagement: { level: engagementLevel(signals), signals },
      subscription: subscription
        ? {
            status: subscription.status,
            plan: subscription.planId,
            active: ACTIVE_SUB_STATUSES.includes(subscription.status),
            currentPeriodEnd: subscription.currentPeriodEnd,
          }
        : null,
      team: {
        memberCount: memberships.length,
        seatLimit: (entitlement?.includedSeats ?? 1) + account.extraSeats,
        pendingInvites,
        members: memberships.map((m) => ({ email: m.email, role: m.role })),
      },
      contacts: {
        total: contactsTotal,
        active: statusCount(RecipientStatus.active),
        lapsed: statusCount(RecipientStatus.lapsed),
        archived: statusCount(RecipientStatus.archived),
        needsAddress,
        listCount,
        bySource,
      },
      occasions: {
        scheduled: scheduledOccasions,
        autoSend: autoSendOccasions,
        upcoming: upcomingOccasions.map((o) => ({
          label: o.title ?? occasionTypeLabel(o.type),
          date: o.dispatchDate ?? o.occasionDate,
        })),
      },
      integrations: {
        crm: crmConnections.map((c) => ({
          provider: c.provider,
          syncEnabled: c.syncEnabled,
          lastSyncedAt: c.lastSyncedAt,
          lastSyncStatus: c.lastSyncStatus,
        })),
        apiKeys: apiKeys.map((k) => ({
          label: k.label,
          prefix: k.prefix,
          lastUsedAt: k.lastUsedAt,
          revoked: k.revokedAt !== null,
        })),
      },
      wallet: { balanceMinor: walletEntry?.balanceAfterMinor ?? 0 },
      designs: { savedCount: savedDesignCount },
      messages: { pageCount: messageStats._count, totalViews: messageStats._sum.viewCount ?? 0 },
      orders: {
        count: paidAgg._count,
        cardsSent,
        totalSpentMinor: paidAgg._sum.totalMinor ?? 0,
        byStatus: ordersByStatus.map((o) => ({ status: o.status, count: o._count })),
        recent: recentOrders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          totalMinor: o.totalMinor,
          currency: o.currency,
          cardCount: o._count.orderRecipients,
          paymentMethod: o.paymentMethod,
          createdAt: o.createdAt,
        })),
      },
      returns: { open: returnsOpen, total: returnsTotal },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function engagementLevel(signals: {
  hasContacts: boolean;
  hasOccasions: boolean;
  hasIntegration: boolean;
  hasOrder: boolean;
}): EngagementLevel {
  // Placed an order and has contacts on file → genuinely using the product.
  if (signals.hasOrder && signals.hasContacts) return "activated";
  // Started setting up (contacts, an integration, or scheduled sends) but not
  // yet ordering → still onboarding.
  if (signals.hasContacts || signals.hasIntegration || signals.hasOccasions) return "onboarding";
  // Signed up but did nothing engageable.
  return "dormant";
}

function occasionTypeLabel(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Midnight today (UTC) — the floor for "upcoming" occasions. */
function startOfToday(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
