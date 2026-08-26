import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { runSerializable } from "../common/run-serializable";
import { AuditService } from "../audit/audit.service";
import { BatchOrdersService } from "../batch-orders/batch-orders.service";
import { WalletService } from "../wallet/wallet.service";
import { STRIPE_CLIENT } from "../billing/stripe-client.provider";
import { SeatBillingService } from "../billing/seat-billing.service";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { BRAND, renderBrandedEmail } from "../email/email-layout";
import { NotificationInboxService } from "../notifications/notification-inbox.service";
import { OpsActivityService } from "../ops-activity/ops-activity.service";
import { SubscriptionInvoicesService } from "../billing/subscription-invoices.service";
import type { EnvConfig } from "../config/env.schema";
import { mapStripeSubscriptionStatus } from "./subscription-status.util";

/** No human is behind a Stripe webhook — audit_log_entries.actor_user_id has
 * no FK constraint, so a readable sentinel is safe and keeps the compliance
 * trail honest about who (or what) actually made the change. */
const SYSTEM_ACTOR = "system:stripe-webhook";

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly batchOrders: BatchOrdersService,
    private readonly wallet: WalletService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
    private readonly inbox: NotificationInboxService,
    private readonly opsActivity: OpsActivityService,
    private readonly subscriptionInvoices: SubscriptionInvoicesService,
    private readonly seatBilling: SeatBillingService,
  ) {}

  /** Verifies the signature first — nothing below this line trusts the
   * payload until constructEvent has proven it was actually sent by Stripe. */
  async handleEvent(rawBody: Buffer, signature: string): Promise<void> {
    const webhookSecret = this.config.get("STRIPE_WEBHOOK_SECRET", { infer: true });
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (error) {
      throw new BadRequestException(
        `Webhook signature verification failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    switch (event.type) {
      // Both route through the same handler, which settles only a *paid*
      // session. A delayed-notification method (e.g. a bank debit) confirms out
      // of band: `completed` fires first with payment_status "unpaid" (a no-op),
      // then `async_payment_succeeded` fires once the money clears. Synchronous
      // methods (card / Apple Pay / Google Pay / Link) settle on `completed`.
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await this.handleCheckoutSessionCompleted(event.data.object);
        break;
      case "checkout.session.async_payment_failed":
        await this.handleAsyncPaymentFailed(event.data.object);
        break;
      case "checkout.session.expired":
        await this.handleCheckoutSessionExpired(event.data.object);
        break;
      case "payment_intent.payment_failed":
        await this.handlePaymentFailed(event.data.object);
        break;
      case "invoice.paid":
        await this.handleInvoicePaid(event.data.object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        // event.created is the ordering key — Stripe delivers at-least-once and
        // out of order, so the handler drops any event older than the one it
        // last applied to the row.
        await this.handleSubscriptionEvent(event.data.object, event.created);
        break;
      default:
        this.logger.debug(`Ignoring unhandled Stripe event type: ${event.type}`);
    }
  }

  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
    // Only act on a session that is actually paid. Synchronous methods (card and
    // the Apple Pay / Google Pay / Link wallets) arrive here with payment_status
    // "paid"; a delayed-notification method arrives "unpaid" on `completed` and
    // is settled later via `async_payment_succeeded` (which re-enters here, now
    // paid). This guard is what makes it safe to offer every Dashboard-enabled
    // payment method at checkout without ever fulfilling an order — or crediting
    // a wallet — before the money has cleared. See docs/adr/0126.
    if (session.payment_status !== "paid") {
      this.logger.log(
        `Checkout session ${session.id} completed but not yet paid (payment_status=${session.payment_status}); awaiting async settlement`,
      );
      return;
    }

    if (session.metadata?.type === "wallet_topup") {
      // A wallet top-up — credit the balance (idempotent) rather than fulfil an
      // order. See wallet.service.ts.
      await this.wallet.applyTopupFromSession(session);
      return;
    }

    const batchOrderId = session.metadata?.batchOrderId;
    if (!batchOrderId) {
      // Subscription-mode sessions carry no batchOrderId — that plan change
      // is handled entirely by the customer.subscription.* events below.
      return;
    }

    const fulfilled = await this.prisma.$transaction(async (tx) => {
      // Status-guarded: Stripe redelivers webhooks at-least-once, so a
      // second delivery of the same event must be a safe no-op, not a
      // second FulfillmentJob per card.
      const { count } = await tx.batchOrder.updateMany({
        where: { id: batchOrderId, status: "pending_payment" },
        data: { status: "paid" },
      });
      if (count === 0) {
        // Not a no-op in every case: a redelivered event for an order
        // already "paid" is the expected, harmless case Stripe's at-least-
        // once delivery guarantees. But if the order is in any OTHER
        // status (e.g. "cancelled" — a customer released a stuck
        // pending_payment order via cancel() at the same moment they
        // completed payment in another tab), Stripe has now been paid for
        // an order this system considers abandoned. Refunds are out of
        // scope for this phase (ADR 0008), so the only safe thing to do
        // is make this loudly auditable rather than silently swallow it.
        const current = await tx.batchOrder.findUnique({ where: { id: batchOrderId } });
        if (current && current.status !== "paid") {
          await this.audit.record({
            accountId: current.accountId,
            actorUserId: SYSTEM_ACTOR,
            action: "payment_succeeded_after_cancel_anomaly",
            targetType: "BatchOrder",
            targetId: batchOrderId,
            metadata: { stripeCheckoutSessionId: session.id, orderStatus: current.status },
          });
        }
        return false;
      }

      // Shared with wallet payment: recipients → queued, a FulfillmentJob per
      // card, and each card's QR message page. See batchOrders.settleFulfillment.
      await this.batchOrders.settleFulfillment(tx, batchOrderId);

      const order = await tx.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } });
      await this.audit.record({
        accountId: order.accountId,
        actorUserId: SYSTEM_ACTOR,
        action: "payment_succeeded",
        targetType: "BatchOrder",
        targetId: batchOrderId,
        metadata: { stripeCheckoutSessionId: session.id },
      });
      return true;
    });

    // Only on the FIRST delivery (fulfilled === true) — never on a redelivery,
    // so the buyer is emailed exactly once. Best-effort: a send failure is
    // logged, not thrown (the payment + fulfilment already succeeded, and the
    // same information is on the success page).
    if (fulfilled) {
      await this.maybeSendOrderEmail(batchOrderId);
      await this.notifyOrderPaid(batchOrderId);
      // Kudos HQ's copy of the same event. After the transaction, like the two
      // above — see OpsActivityService for why it can't go inside one.
      await this.opsActivity.orderPaid(batchOrderId);
    }
  }

  /**
   * Attach Stripe's generated VAT invoice to a card order so the buyer can
   * download it as their receipt. Fired when `invoice_creation` (enabled on the
   * card-order Checkout Session) produces an invoice — the event carries the
   * whole invoice, including the finalized PDF + hosted URL, so there's no extra
   * Stripe call. The `batchOrderId` we set on the invoice metadata links it back.
   * A **subscription** invoice carries no batchOrderId, and is recorded instead
   * as SubscriptionInvoice — that's the only place subscription income is ever
   * written down, since `Subscription` holds current state and no amounts.
   * updateMany makes an unknown/absent order a safe no-op and the write
   * idempotent under Stripe's at-least-once redelivery. See ADR 0102.
   */
  private async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const batchOrderId = invoice.metadata?.batchOrderId;
    if (!batchOrderId) {
      await this.recordSubscriptionInvoice(invoice);
      return;
    }
    await this.prisma.batchOrder.updateMany({
      where: { id: batchOrderId },
      data: {
        stripeInvoiceId: invoice.id,
        receiptUrl: invoice.hosted_invoice_url ?? null,
        receiptPdfUrl: invoice.invoice_pdf ?? null,
      },
    });
  }

  /**
   * Hand a subscription invoice to the one place that records them.
   *
   * Deliberately the same code path the historical backfill uses — two
   * implementations of "what has this customer paid us" would drift, and the
   * difference would surface as money that doesn't reconcile.
   *
   * Best-effort: a bookkeeping failure must never make this webhook 500 and
   * have Stripe retry a payment we've already handled.
   */
  private async recordSubscriptionInvoice(invoice: Stripe.Invoice): Promise<void> {
    try {
      await this.subscriptionInvoices.record(invoice);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Recording subscription invoice ${invoice.id} failed: ${reason}`);
    }
  }

  /** Drop a persisted inbox note to the whole team that a paid order is now in
   * production. Best-effort — the payment + fulfilment already committed, so a
   * notification failure must never surface as a webhook error (Stripe would
   * retry and re-fulfil). Idempotent on the order id, so a redelivery is a
   * no-op even if this somehow runs twice. See docs/adr/0034-notification-inbox.md. */
  private async notifyOrderPaid(batchOrderId: string): Promise<void> {
    try {
      const order = await this.prisma.batchOrder.findUnique({
        where: { id: batchOrderId },
        select: {
          accountId: true,
          orderNumber: true,
          _count: { select: { orderRecipients: true } },
        },
      });
      if (!order) return;
      const cards = order._count.orderRecipients;
      await this.inbox.notifyAccount(order.accountId, {
        kind: "order_paid",
        title: `Order ORD-${order.orderNumber} is paid`,
        body: `${cards} card${cards === 1 ? "" : "s"} are now in production.`,
        href: `/orders/${batchOrderId}`,
        entityType: "BatchOrder",
        entityId: batchOrderId,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Order-paid notification for ${batchOrderId} failed: ${reason}`);
    }
  }

  /** After a paid order is fulfilled, email the buyer a branded confirmation.
   * A guest (account still unclaimed → has a claim token) gets a receipt with
   * the account-claim link; an account holder gets an order confirmation with a
   * link to view the order. A no-op if the account has no contact email.
   * Best-effort. See docs/adr/0025. */
  private async maybeSendOrderEmail(batchOrderId: string): Promise<void> {
    try {
      const order = await this.prisma.batchOrder.findUnique({
        where: { id: batchOrderId },
        select: {
          accountId: true,
          orderNumber: true,
          totalMinor: true,
          _count: { select: { orderRecipients: true } },
        },
      });
      if (!order) return;
      const account = await this.prisma.account.findUnique({
        where: { id: order.accountId },
        select: { name: true, contactEmail: true, claimToken: true },
      });
      if (!account?.contactEmail) return;

      const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
      if (account.claimToken) {
        await this.sendGuestReceipt(webAppUrl, account.contactEmail, account.claimToken);
      } else {
        await this.sendOrderConfirmation(webAppUrl, account.contactEmail, {
          orderNumber: order.orderNumber,
          cardCount: order._count.orderRecipients,
          totalMinor: order.totalMinor,
          orderId: batchOrderId,
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Order email for ${batchOrderId} failed: ${reason}`);
    }
  }

  /** Guest one-off order: receipt carrying the account-claim link. */
  private async sendGuestReceipt(webAppUrl: string, to: string, claimToken: string): Promise<void> {
    const claimUrl = `${webAppUrl}/gift/claim?token=${encodeURIComponent(claimToken)}`;
    await this.email.sendTransactional({
      to,
      subject: "Your Kudos card is on its way 🎉",
      // A Brevo template (if configured) is used; otherwise the HTML below.
      // Template param, for reference: {{ params.claimUrl }} — the claim link.
      templateId: this.config.get("BREVO_GUEST_RECEIPT_TEMPLATE_ID", { infer: true }),
      params: { claimUrl },
      html: renderBrandedEmail({
        webAppUrl,
        preheader: "Your Kudos card is on its way — create a free account to claim it.",
        heading: "Thanks — your card is on its way!",
        bodyHtml: `
          <p style="margin:0 0 16px">We're printing your card now and posting it out.</p>
          <div style="background:${BRAND.accentSoft};border-radius:12px;padding:18px 20px">
            <p style="margin:0 0 6px;font-weight:600;color:${BRAND.ink}">Never miss their birthday again</p>
            <p style="margin:0;color:${BRAND.muted}">
              Create a free account to save this contact, get a reminder next year, and let us
              send the card for you automatically.
            </p>
          </div>`,
        cta: { url: claimUrl, label: "Create your free account" },
      }),
    });
  }

  /** Account holder: order confirmation with the order summary and a view link. */
  private async sendOrderConfirmation(
    webAppUrl: string,
    to: string,
    order: { orderNumber: number; cardCount: number; totalMinor: number; orderId: string },
  ): Promise<void> {
    const orderRef = `ORD-${order.orderNumber}`;
    const total = `£${(order.totalMinor / 100).toFixed(2)}`;
    const cards = order.cardCount === 1 ? "1 card" : `${order.cardCount} cards`;
    const orderUrl = `${webAppUrl}/orders/${order.orderId}`;
    await this.email.sendTransactional({
      to,
      subject: `Order ${orderRef} confirmed`,
      // A Brevo template (if configured) is used; otherwise the HTML below.
      // Template params, for reference: {{ params.orderNumber }}, {{ params.cardCount }},
      // {{ params.total }}, {{ params.orderUrl }}.
      templateId: this.config.get("BREVO_ORDER_CONFIRMATION_TEMPLATE_ID", { infer: true }),
      params: { orderNumber: orderRef, cardCount: order.cardCount, total, orderUrl },
      html: renderBrandedEmail({
        webAppUrl,
        preheader: `Order ${orderRef} confirmed — ${cards} on the way.`,
        heading: "Your order is confirmed 🎉",
        bodyHtml: `
          <p style="margin:0 0 16px">Thanks — we've received your payment and your ${cards} ${
            order.cardCount === 1 ? "is" : "are"
          } being printed and posted.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:${BRAND.accentSoft};border-radius:12px;margin:0 0 4px">
            <tr>
              <td style="padding:16px 20px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:4px 0;color:${BRAND.muted}">Order</td>
                    <td align="right" style="padding:4px 0;font-weight:600;color:${BRAND.ink}">${orderRef}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;color:${BRAND.muted}">Cards</td>
                    <td align="right" style="padding:4px 0;font-weight:600;color:${BRAND.ink}">${cards}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;color:${BRAND.muted}">Total paid</td>
                    <td align="right" style="padding:4px 0;font-weight:600;color:${BRAND.ink}">${total}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>`,
        cta: { url: orderUrl, label: "View your order" },
      }),
    });
  }

  private async handlePaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const order = await this.prisma.batchOrder.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });
    if (!order) {
      return;
    }

    // BatchOrder stays "pending_payment" — Stripe Checkout's hosted page lets
    // the customer retry with a different card on the same session without
    // any new event here. The order is only released if the session is
    // outright abandoned (handleCheckoutSessionExpired) or manually
    // cancelled (BatchOrdersService.cancel).
    await this.audit.record({
      accountId: order.accountId,
      actorUserId: SYSTEM_ACTOR,
      action: "payment_failed",
      targetType: "BatchOrder",
      targetId: order.id,
      metadata: { stripePaymentIntentId: paymentIntent.id },
    });
  }

  /** Stripe expires an unpaid Checkout Session (default: 24h after creation)
   * if the customer never completes or abandons it. Hands the order back to
   * "draft" so it isn't stuck in "pending_payment" forever with no route to
   * retry other than the manual cancel endpoint. */
  private async handleCheckoutSessionExpired(session: Stripe.Checkout.Session): Promise<void> {
    const batchOrderId = session.metadata?.batchOrderId;
    if (!batchOrderId) {
      return;
    }

    const { count } = await this.prisma.batchOrder.updateMany({
      where: { id: batchOrderId, status: "pending_payment" },
      data: { status: "draft" },
    });
    if (count === 0) {
      return;
    }

    const order = await this.prisma.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } });
    // The session held a reserved wallet draw for as long as it was live. It
    // never will be paid now, so the money goes back — otherwise abandoning a
    // checkout would quietly cost the customer their balance. See ADR 0169.
    await this.batchOrders.releaseWalletReservation(order.accountId, batchOrderId);
    await this.audit.record({
      accountId: order.accountId,
      actorUserId: SYSTEM_ACTOR,
      action: "checkout_session_expired",
      targetType: "BatchOrder",
      targetId: batchOrderId,
      metadata: { stripeCheckoutSessionId: session.id },
    });
  }

  /**
   * A delayed-notification payment (e.g. a bank debit) failed to clear after the
   * Checkout Session completed. Nothing was ever fulfilled or credited — the
   * `completed` event was skipped because the session was still "unpaid" (see the
   * payment_status guard) — so this releases the stranded order back to `draft`
   * so the buyer can retry, mirroring an expired session, and hands back any
   * wallet draw the session was holding. A wallet top-up is credited only on
   * success, so a failed top-up needs no undo. Synchronous methods
   * (card/wallets/Link) never reach this event.
   */
  private async handleAsyncPaymentFailed(session: Stripe.Checkout.Session): Promise<void> {
    if (session.metadata?.type === "wallet_topup") {
      return;
    }
    const batchOrderId = session.metadata?.batchOrderId;
    if (!batchOrderId) {
      return;
    }

    const { count } = await this.prisma.batchOrder.updateMany({
      where: { id: batchOrderId, status: "pending_payment" },
      data: { status: "draft" },
    });
    if (count === 0) {
      return;
    }

    const order = await this.prisma.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } });
    // Same reasoning as an expired session: the wallet was debited when the
    // session was created, and this payment is never going to clear, so the
    // money goes back. See ADR 0169.
    await this.batchOrders.releaseWalletReservation(order.accountId, batchOrderId);
    await this.audit.record({
      accountId: order.accountId,
      actorUserId: SYSTEM_ACTOR,
      action: "async_payment_failed",
      targetType: "BatchOrder",
      targetId: batchOrderId,
      metadata: { stripeCheckoutSessionId: session.id },
    });
  }

  private async handleSubscriptionEvent(
    subscription: Stripe.Subscription,
    eventCreatedSeconds: number,
  ): Promise<void> {
    const accountId = subscription.metadata.accountId;
    const planId = subscription.metadata.planId;
    if (!accountId || !planId) {
      this.logger.warn(
        `Stripe subscription ${subscription.id} is missing accountId/planId metadata; ignoring`,
      );
      return;
    }

    const status = mapStripeSubscriptionStatus(subscription.status);
    const currentPeriodEndSeconds = subscription.items.data[0]?.current_period_end;
    if (currentPeriodEndSeconds === undefined) {
      this.logger.warn(`Stripe subscription ${subscription.id} has no billing period; ignoring`);
      return;
    }
    const currentPeriodEnd = new Date(currentPeriodEndSeconds * 1000);
    const eventCreatedAt = new Date(eventCreatedSeconds * 1000);

    // Keep the local extra-seat count aligned with the subscription's per-seat
    // line item, so a change made via proration, the Stripe dashboard, or a
    // cancellation reconciles here too (the invite hard-block reads this).
    const seatPriceId = await this.seatBilling.resolveSeatPriceId();
    const seatQuantity = seatPriceId
      ? (subscription.items.data.find((item) => item.price.id === seatPriceId)?.quantity ?? 0)
      : null;
    const canceled = status === "canceled";
    const accountData: Prisma.AccountUpdateInput = {
      // A cancelled subscription drops the account back to the free plan; any
      // other status (including past_due) keeps the paid plan's entitlements
      // active for a grace period rather than cutting access off on the first
      // failed payment.
      planId: canceled ? "free" : planId,
    };
    if (canceled) {
      // Back on free: no paid seats remain.
      accountData.extraSeats = 0;
    } else if (seatQuantity !== null) {
      accountData.extraSeats = seatQuantity;
    }

    // Serializable read-then-write: Stripe delivers subscription webhooks
    // at-least-once and out of order, so we compare against what's already
    // persisted and drop anything stale before touching the account's plan. The
    // read + guarded write must be atomic against a concurrent redelivery, hence
    // Serializable rather than the previous plain multi-statement transaction.
    const applied = await runSerializable(this.prisma, async (tx) => {
      const existing = await tx.subscription.findUnique({
        where: { stripeSubscriptionId: subscription.id },
        select: { status: true, lastEventAt: true },
      });

      if (existing) {
        // Terminal guard: a Stripe subscription id never re-activates once
        // cancelled — a resubscribe issues a brand-new id. So any non-cancel
        // event arriving for an already-cancelled row can only be a stale or
        // replayed `updated`; applying it would wrongly restore the paid plan.
        if (existing.status === "canceled" && !canceled) {
          return false;
        }
        // Ordering guard: ignore an event strictly older than the last one
        // applied. Equal timestamps pass through — a genuine same-second
        // transition (e.g. updated then deleted) must still land, and a true
        // duplicate simply rewrites identical data.
        if (existing.lastEventAt && eventCreatedAt < existing.lastEventAt) {
          return false;
        }
      }

      await tx.subscription.upsert({
        where: { stripeSubscriptionId: subscription.id },
        create: {
          accountId,
          planId,
          stripeSubscriptionId: subscription.id,
          status,
          currentPeriodEnd,
          lastEventAt: eventCreatedAt,
        },
        update: { planId, status, currentPeriodEnd, lastEventAt: eventCreatedAt },
      });
      await tx.account.update({ where: { id: accountId }, data: accountData });
      return true;
    });

    if (!applied) {
      this.logger.log(
        `Ignoring stale/out-of-order Stripe subscription event for ${subscription.id} ` +
          `(status=${status}, event created ${eventCreatedAt.toISOString()})`,
      );
      return;
    }

    await this.audit.record({
      accountId,
      actorUserId: SYSTEM_ACTOR,
      action: "subscription_updated",
      targetType: "Subscription",
      targetId: subscription.id,
      metadata: { status, planId },
    });
  }
}
