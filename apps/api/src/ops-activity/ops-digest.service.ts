import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { startOfUtcDay } from "@kudos/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import type { EnvConfig } from "../config/env.schema";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { BRAND, escapeHtml, renderBrandedEmail } from "../email/email-layout";
import { PlatformNotificationService } from "../platform-notifications/platform-notification.service";
import { PAID_STATUSES } from "../admin/admin.service";
import { formatMinor } from "./ops-activity.service";

/** One new account with a login, for the digest's sign-up list. */
export interface DigestSignup {
  accountId: string;
  name: string;
  type: string;
  planId: string | null;
  email: string | null;
}

/** One order that was paid for during the digest window. */
export interface DigestOrder {
  id: string;
  orderNumber: number;
  accountName: string;
  cards: number;
  totalMinor: number;
}

/** What one digest run found — returned for tests, logging and the ops trigger. */
export interface OpsDigestSummary {
  /** The UTC day being reported, as `YYYY-MM-DD`. */
  day: string;
  signups: DigestSignup[];
  orders: DigestOrder[];
  /** Free reprints under the Kudos Promise — counted, never billed. */
  reprints: number;
  /** Cards actually put in the post during the window. */
  cardsPosted: number;
  /** Distinct orders those posted cards belonged to. */
  ordersPosted: number;
  revenueMinor: number;
  adminsEmailed: number;
}

interface PostedRow {
  orders: number;
  cards: number;
}

/**
 * The Kudos HQ daily digest: what came in and what went out yesterday, emailed
 * to super admins each morning and recorded in the ops notification centre.
 *
 * Three numbers, three exact sources — none of them guessed:
 *
 * - **New sign-ups** are owner memberships created in the window, *not* accounts
 *   created. A guest one-off purchase mints a real Account (name "Guest", claim
 *   token, no membership), so counting accounts would report every one-off card
 *   sale as a sign-up. `owner` is created in exactly two places — normal signup
 *   and a guest claiming their account — and invites can only grant admin/staff,
 *   so this is exact rather than approximate.
 *
 * - **Orders paid** are keyed off their fulfilment jobs, because `BatchOrder`
 *   has no `paidAt` column. Every payment path (Stripe webhook, wallet debit,
 *   auto-send, reprint) creates the order's `FulfillmentJob` rows inside the
 *   same transaction that flips the order to `paid`, so a job's `createdAt` *is*
 *   the payment moment. Using `BatchOrder.createdAt` instead would misfile any
 *   checkout that was abandoned and resumed the next day, and silently drop it
 *   from every digest — a business summary quietly missing orders is worse than
 *   no summary. (A real `paidAt` column would be cleaner; it is a migration, and
 *   it would also fix the admin overview's revenue-by-`created_at`. Noted, not
 *   done here.)
 *
 * - **Cards posted** come from `FulfillmentJob.postedAt`, stamped exactly when
 *   an operator transitions a job to `posted`.
 *
 * Unlike the dispatch reminder, this is **not** suppressed on a quiet day. That
 * reminder is an action list — nothing to post, nothing to say. This is a
 * report, and a zero is a fact worth seeing; more to the point, a silent morning
 * would be indistinguishable from a dead cron.
 */
@Injectable()
export class OpsDigestService {
  private readonly logger = new Logger(OpsDigestService.name);

  constructor(
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly prisma: PrismaService,
    private readonly platformNotifications: PlatformNotificationService,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
  ) {}

  /**
   * 07:30 UTC daily. After the 07:00 auto-send run, so a card auto-sent this
   * morning is already counted if it lands in tomorrow's window, and clear of
   * the other daily crons (03:00–09:00 are otherwise taken).
   */
  @Cron("30 7 * * *")
  async scheduledDigest(): Promise<void> {
    await this.runDailyDigest();
  }

  /**
   * The digest itself — runnable directly by tests and the on-demand ops
   * trigger. Reports the **previous full UTC day**, so the window is closed and
   * a re-run produces the same numbers.
   */
  async runDailyDigest(now: Date = new Date()): Promise<OpsDigestSummary> {
    const to = startOfUtcDay(now);
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 1);
    const day = from.toISOString().slice(0, 10);

    const [signups, orders, posted] = await Promise.all([
      this.newSignups(from, to),
      this.ordersPaid(from, to),
      this.cardsPosted(from, to),
    ]);
    // Keyed off the orders we actually found, not off a timestamp on the case —
    // `ReturnCase.updatedAt` moves for unrelated reasons, so it would be a guess.
    const reprints = await this.reprintOrderIds(orders.map((order) => order.id));

    // A reprint is a paid £0 order created by the returns flow, so it shows up
    // in ordersPaid() and has to be taken back out: counting it would overstate
    // volume, and it is service recovery rather than a sale.
    const billable = orders.filter((order) => !reprints.has(order.id));
    const revenueMinor = billable.reduce((sum, order) => sum + order.totalMinor, 0);

    const summary: OpsDigestSummary = {
      day,
      signups,
      orders: billable,
      reprints: reprints.size,
      cardsPosted: posted.cards,
      ordersPosted: posted.orders,
      revenueMinor,
      adminsEmailed: 0,
    };

    // The in-app entry first and regardless of email, exactly as the dispatch
    // reminder does — an operator with no email set still sees the digest. Keyed
    // on the reported day, so a re-fired cron is a no-op. `created` is the
    // "first run wins" guard: if another instance already wrote today's entry it
    // has already emailed, so we stop rather than send twice.
    let created = true;
    try {
      created = await this.platformNotifications.notifyAllAdmins({
        kind: "daily_summary",
        title: this.notificationTitle(summary),
        body: this.notificationBody(summary),
        href: "/admin",
        entityType: "ops_daily_digest",
        entityId: day,
      });
    } catch (error) {
      // Losing the dedupe guard beats losing the digest — fall through and email.
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Daily digest in-app notification failed: ${reason}`);
    }
    if (!created) {
      this.logger.log(`Daily digest for ${day} already recorded — not re-sending`);
      return summary;
    }

    summary.adminsEmailed = await this.emailDigest(summary);
    this.logger.log(
      `Daily digest ${day}: ${billable.length} order(s), ${signups.length} sign-up(s), ${posted.cards} card(s) posted → ${summary.adminsEmailed} super admin(s)`,
    );
    return summary;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Accounts that gained an owner in the window — see the class comment. */
  private async newSignups(from: Date, to: Date): Promise<DigestSignup[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { role: "owner", createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: "asc" },
      select: {
        email: true,
        account: { select: { id: true, name: true, type: true, planId: true } },
      },
    });
    return memberships.map((membership) => ({
      accountId: membership.account.id,
      name: membership.account.name,
      type: membership.account.type,
      planId: membership.account.planId,
      email: membership.email,
    }));
  }

  /** Orders whose fulfilment jobs were created in the window — see the class
   *  comment for why that is the payment moment. */
  private async ordersPaid(from: Date, to: Date): Promise<DigestOrder[]> {
    const orders = await this.prisma.batchOrder.findMany({
      where: {
        status: { in: PAID_STATUSES },
        orderRecipients: { some: { fulfillmentJob: { createdAt: { gte: from, lt: to } } } },
      },
      orderBy: { orderNumber: "asc" },
      select: {
        id: true,
        orderNumber: true,
        totalMinor: true,
        account: { select: { name: true } },
        _count: { select: { orderRecipients: true } },
      },
    });
    return orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      accountName: order.account.name,
      cards: order._count.orderRecipients,
      totalMinor: order.totalMinor,
    }));
  }

  /** Which of these orders are free reprints raised by the returns flow. */
  private async reprintOrderIds(orderIds: string[]): Promise<Set<string>> {
    if (orderIds.length === 0) {
      return new Set();
    }
    const cases = await this.prisma.returnCase.findMany({
      where: { recoveryOrderId: { in: orderIds } },
      select: { recoveryOrderId: true },
    });
    return new Set(
      cases
        .map((returnCase) => returnCase.recoveryOrderId)
        .filter((id): id is string => id !== null),
    );
  }

  /** Cards put in the post, and how many orders they came from. One aggregate
   *  query rather than loading a row per card — a busy day is thousands. */
  private async cardsPosted(from: Date, to: Date): Promise<PostedRow> {
    const rows = await this.prisma.$queryRaw<PostedRow[]>`
      SELECT COUNT(DISTINCT orc.batch_order_id)::int AS orders, COUNT(*)::int AS cards
      FROM fulfillment_jobs fj
      JOIN order_recipients orc ON orc.id = fj.order_recipient_id
      WHERE fj.posted_at >= ${from} AND fj.posted_at < ${to}
    `;
    return rows[0] ?? { orders: 0, cards: 0 };
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private notificationTitle(summary: OpsDigestSummary): string {
    const orders = summary.orders.length;
    const signups = summary.signups.length;
    return `Yesterday: ${orders} order${orders === 1 ? "" : "s"}, ${signups} sign-up${signups === 1 ? "" : "s"}`;
  }

  private notificationBody(summary: OpsDigestSummary): string {
    const parts = [
      `${formatMinor(summary.revenueMinor)} ordered`,
      `${summary.cardsPosted} card${summary.cardsPosted === 1 ? "" : "s"} posted`,
    ];
    if (summary.reprints > 0) {
      parts.push(`${summary.reprints} free reprint${summary.reprints === 1 ? "" : "s"}`);
    }
    return `${parts.join(" · ")} (${summary.day}).`;
  }

  /** Distinct super-admin emails, lower-cased. The digest is a business summary,
   *  so it goes to super admins rather than every operator. */
  private async superAdminEmails(): Promise<string[]> {
    const admins = await this.prisma.platformAdmin.findMany({
      where: { role: "super_admin", email: { not: null } },
      select: { email: true },
    });
    return [
      ...new Set(
        admins
          .map((admin) => admin.email?.trim().toLowerCase())
          .filter((email): email is string => !!email && email.length > 0),
      ),
    ];
  }

  /** One email per recipient, isolating per-address failures. */
  private async emailDigest(summary: OpsDigestSummary): Promise<number> {
    const emails = await this.superAdminEmails();
    if (emails.length === 0) {
      this.logger.warn("Daily digest: no super admin has an email set");
      return 0;
    }
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    const subject = `Kudos daily — ${summary.orders.length} order${summary.orders.length === 1 ? "" : "s"}, ${summary.signups.length} sign-up${summary.signups.length === 1 ? "" : "s"} (${summary.day})`;
    const html = renderBrandedEmail({
      webAppUrl,
      preheader: this.notificationBody(summary),
      heading: `Yesterday at Kudos — ${summary.day}`,
      bodyHtml: this.renderBody(summary),
      cta: { url: `${webAppUrl}/admin`, label: "Open the dashboard" },
    });

    let sent = 0;
    for (const to of emails) {
      try {
        await this.email.sendTransactional({ to, subject, html });
        sent += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Daily digest to ${to} failed: ${reason}`);
      }
    }
    return sent;
  }

  private renderBody(summary: OpsDigestSummary): string {
    return [
      this.renderStats(summary),
      this.renderOrders(summary),
      this.renderSignups(summary),
    ].join("");
  }

  /** The three headline numbers, as a table — email clients and flexbox don't mix. */
  private renderStats(summary: OpsDigestSummary): string {
    const cells = [
      { label: "Orders", value: String(summary.orders.length) },
      { label: "Ordered", value: formatMinor(summary.revenueMinor) },
      { label: "Cards posted", value: String(summary.cardsPosted) },
      { label: "Sign-ups", value: String(summary.signups.length) },
    ];
    const tds = cells
      .map(
        (cell) => `<td align="center" style="padding:12px 8px">
             <div style="font-size:22px;font-weight:700;color:${BRAND.ink}">${cell.value}</div>
             <div style="font-size:12px;color:${BRAND.muted}">${cell.label}</div>
           </td>`,
      )
      .join("");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="margin:0 0 20px;background:${BRAND.canvas};border-radius:12px">
        <tr>${tds}</tr>
      </table>`;
  }

  private renderOrders(summary: OpsDigestSummary): string {
    const reprintNote =
      summary.reprints > 0
        ? `<p style="margin:0 0 12px;font-size:13px;color:${BRAND.muted}">Plus ${summary.reprints} free reprint${summary.reprints === 1 ? "" : "s"} under the Kudos Promise (not counted above).</p>`
        : "";

    if (summary.orders.length === 0) {
      return `<h2 style="margin:0 0 8px;font-size:16px;color:${BRAND.ink}">Orders</h2>
        <p style="margin:0 0 12px;font-size:14px;color:${BRAND.muted}">No orders were paid for yesterday.</p>${reprintNote}`;
    }

    const rows = summary.orders
      .map(
        (order) => `<tr>
             <td style="padding:6px 0;font-size:14px;color:${BRAND.ink}">ORD-${order.orderNumber}</td>
             <td style="padding:6px 0;font-size:14px;color:${BRAND.muted}">${escapeHtml(order.accountName)}</td>
             <td align="right" style="padding:6px 0;font-size:14px;color:${BRAND.muted}">${order.cards} card${order.cards === 1 ? "" : "s"}</td>
             <td align="right" style="padding:6px 0;font-size:14px;font-weight:600;color:${BRAND.ink}">${formatMinor(order.totalMinor)}</td>
           </tr>`,
      )
      .join("");

    return `<h2 style="margin:0 0 8px;font-size:16px;color:${BRAND.ink}">Orders</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px">${rows}</table>${reprintNote}`;
  }

  private renderSignups(summary: OpsDigestSummary): string {
    if (summary.signups.length === 0) {
      return `<h2 style="margin:0 0 8px;font-size:16px;color:${BRAND.ink}">Sign-ups</h2>
        <p style="margin:0;font-size:14px;color:${BRAND.muted}">Nobody new signed up yesterday.</p>`;
    }
    const rows = summary.signups
      .map(
        (signup) => `<tr>
             <td style="padding:6px 0;font-size:14px;color:${BRAND.ink}">${escapeHtml(signup.name)}</td>
             <td style="padding:6px 0;font-size:14px;color:${BRAND.muted}">${signup.type === "organisation" ? "Organisation" : "Individual"}</td>
             <td align="right" style="padding:6px 0;font-size:14px;color:${BRAND.muted}">${escapeHtml(signup.planId ?? "free")}</td>
           </tr>`,
      )
      .join("");
    return `<h2 style="margin:0 0 8px;font-size:16px;color:${BRAND.ink}">Sign-ups</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
  }
}
