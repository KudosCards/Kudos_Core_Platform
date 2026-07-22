import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BatchOrdersService } from "../batch-orders/batch-orders.service";
import { WalletService } from "../wallet/wallet.service";
import { STRIPE_CLIENT } from "../billing/stripe-client.provider";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { BRAND, renderBrandedEmail } from "../email/email-layout";
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
      case "checkout.session.completed":
        await this.handleCheckoutSessionCompleted(event.data.object);
        break;
      case "checkout.session.expired":
        await this.handleCheckoutSessionExpired(event.data.object);
        break;
      case "payment_intent.payment_failed":
        await this.handlePaymentFailed(event.data.object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await this.handleSubscriptionEvent(event.data.object);
        break;
      default:
        this.logger.debug(`Ignoring unhandled Stripe event type: ${event.type}`);
    }
  }

  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
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
  private async sendGuestReceipt(
    webAppUrl: string,
    to: string,
    claimToken: string,
  ): Promise<void> {
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
    await this.audit.record({
      accountId: order.accountId,
      actorUserId: SYSTEM_ACTOR,
      action: "checkout_session_expired",
      targetType: "BatchOrder",
      targetId: batchOrderId,
      metadata: { stripeCheckoutSessionId: session.id },
    });
  }

  private async handleSubscriptionEvent(subscription: Stripe.Subscription): Promise<void> {
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

    await this.prisma.$transaction([
      this.prisma.subscription.upsert({
        where: { stripeSubscriptionId: subscription.id },
        create: {
          accountId,
          planId,
          stripeSubscriptionId: subscription.id,
          status,
          currentPeriodEnd,
        },
        update: { planId, status, currentPeriodEnd },
      }),
      // A cancelled subscription drops the account back to the free plan;
      // any other status (including past_due) keeps the paid plan's
      // entitlements active for a grace period rather than cutting access
      // off on the first failed payment.
      this.prisma.account.update({
        where: { id: accountId },
        data: { planId: status === "canceled" ? "free" : planId },
      }),
    ]);

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
