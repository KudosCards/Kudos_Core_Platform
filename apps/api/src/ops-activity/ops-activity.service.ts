import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PlatformNotificationService } from "../platform-notifications/platform-notification.service";

/** "£1,234.50" — ops-facing money, always to the penny and thousands-separated. */
export function formatMinor(minor: number): string {
  return `£${(minor / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The live half of "what Kudos HQ gets told about" — the events worth an entry
 * in the ops notification centre the moment they happen, rather than waiting for
 * the next morning's digest (see OpsDigestService for that half).
 *
 * **Every method here must be called AFTER the originating transaction commits,
 * never inside it.** Two reasons, and the second is the one that bites:
 *
 * 1. A notification failure must never fail a payment or a signup. The account
 *    inbox follows the same rule — see webhooks.service.ts notifyOrderPaid.
 * 2. A try/catch *inside* a Postgres transaction does not save you. Once a
 *    statement errors, Postgres marks the whole transaction aborted and every
 *    later statement fails too, so "best-effort inside the tx" would take the
 *    payment down with it.
 *
 * Both producers are idempotent on `(kind, entityId)` via notifyAllAdmins, so a
 * redelivered Stripe webhook — or a second call from another payment path —
 * is a no-op rather than a duplicate row in every operator's bell.
 *
 * Fan-out is to **all** operators, not just super admins: these are routine
 * business events, and that matches the existing `dispatch_reminder`. Only
 * genuine escalations are role-restricted (`dispatch_escalation`). Narrowing
 * this is a one-line change — pass `{ role: "super_admin" }`.
 */
@Injectable()
export class OpsActivityService {
  private readonly logger = new Logger(OpsActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformNotifications: PlatformNotificationService,
  ) {}

  /**
   * A paid order landed. Called from every path that takes money — the Stripe
   * webhook, an interactive wallet payment, and auto-send — because they each
   * flip the order to `paid` themselves; there is no single post-commit hook.
   * (`settleFulfillment` *is* the shared choke point, but it runs inside the
   * payment transaction, which rule 2 above rules out.)
   *
   * Deliberately NOT called for a returned-card reprint: that order is created
   * already `paid` at £0 as service recovery under the Kudos Promise (ADR 0039),
   * and reporting it as a new order would overstate both volume and revenue.
   */
  async orderPaid(batchOrderId: string): Promise<void> {
    try {
      const order = await this.prisma.batchOrder.findUnique({
        where: { id: batchOrderId },
        select: {
          orderNumber: true,
          totalMinor: true,
          account: { select: { name: true } },
          _count: { select: { orderRecipients: true } },
        },
      });
      if (!order) return;

      const cards = order._count.orderRecipients;
      await this.platformNotifications.notifyAllAdmins({
        kind: "new_order",
        title: `New order ORD-${order.orderNumber} — ${formatMinor(order.totalMinor)}`,
        body: `${cards} card${cards === 1 ? "" : "s"} for ${order.account.name}.`,
        href: `/admin/orders/${batchOrderId}`,
        entityType: "BatchOrder",
        entityId: batchOrderId,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Ops new-order notification for ${batchOrderId} failed: ${reason}`);
    }
  }

  /**
   * Cards that were refunded but are still sitting in Royal Mail's Click & Drop
   * queue, because the delete was rejected or unreachable. Royal Mail will print
   * and post them unless an operator removes them by hand, and the customer's
   * money has already gone back — so this is a genuine escalation, not routine
   * activity, and goes to super admins only (the `dispatch_escalation` pattern).
   *
   * Not idempotency-keyed on the order: a second failed attempt on the same
   * order is new information (the first alert was not acted on, or the cards
   * changed), and a suppressed duplicate here would mean a card quietly posts.
   */
  async clickAndDropCancelFailed(
    batchOrderId: string,
    failures: { orderIdentifier: string; reason: string }[],
  ): Promise<void> {
    if (failures.length === 0) return;
    try {
      const order = await this.prisma.batchOrder.findUnique({
        where: { id: batchOrderId },
        select: { orderNumber: true, account: { select: { name: true } } },
      });
      const reference = order ? `ORD-${order.orderNumber}` : batchOrderId;
      const cards = failures.length;
      await this.platformNotifications.notifyAllAdmins(
        {
          kind: "click_and_drop_cancel_failed",
          title: `Refunded ${reference} — ${cards} card${cards === 1 ? "" : "s"} still in Click & Drop`,
          body:
            `The refund went through, but Royal Mail would not delete ${cards === 1 ? "this order" : "these orders"}: ` +
            `${failures.map((f) => `${f.orderIdentifier} (${f.reason})`).join("; ")}. ` +
            `Remove ${cards === 1 ? "it" : "them"} in Click & Drop or the card${cards === 1 ? "" : "s"} will be posted.`,
          href: `/admin/orders/${batchOrderId}`,
          entityType: "BatchOrder",
        },
        { role: "super_admin" },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `Click & Drop cancel-failure alert for ${batchOrderId} could not be raised: ${reason}`,
      );
    }
  }

  /**
   * Somebody signed up. Called from both routes into an account with a login:
   * a normal signup, and a guest one-off buyer later claiming the account they
   * bought from (ADR 0025).
   *
   * The guest *purchase* itself deliberately doesn't come through here. It mints
   * a real Account row — name "Guest", a claim token, no membership — so
   * counting accounts would report every one-off card sale as a new sign-up.
   * An account only becomes a sign-up when it gains an owner.
   */
  async accountSignedUp(accountId: string): Promise<void> {
    try {
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
        select: { name: true, type: true, planId: true },
      });
      if (!account) return;

      await this.platformNotifications.notifyAllAdmins({
        kind: "new_signup",
        title: `New sign-up — ${account.name}`,
        body: `${account.type === "organisation" ? "Organisation" : "Individual"} on the ${account.planId ?? "free"} plan.`,
        href: `/admin/subscribers/${accountId}`,
        entityType: "Account",
        entityId: accountId,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Ops new-signup notification for ${accountId} failed: ${reason}`);
    }
  }
}
