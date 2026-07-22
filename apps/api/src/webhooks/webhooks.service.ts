import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BatchOrdersService } from "../batch-orders/batch-orders.service";
import { WalletService } from "../wallet/wallet.service";
import { STRIPE_CLIENT } from "../billing/stripe-client.provider";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
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
    // so a guest is emailed their claim link exactly once. Best-effort: a send
    // failure is logged, not thrown (the payment + fulfilment already succeeded,
    // and the claim link is also on the success page).
    if (fulfilled) {
      await this.maybeSendGuestReceipt(batchOrderId);
    }
  }

  /** For a guest one-off order (account still unclaimed → has a claim token and a
   * contact email), email the buyer their receipt with the account-claim link.
   * A no-op for account holders. See docs/adr/0025. */
  private async maybeSendGuestReceipt(batchOrderId: string): Promise<void> {
    try {
      const order = await this.prisma.batchOrder.findUnique({
        where: { id: batchOrderId },
        select: { accountId: true },
      });
      if (!order) return;
      const account = await this.prisma.account.findUnique({
        where: { id: order.accountId },
        select: { name: true, contactEmail: true, claimToken: true },
      });
      if (!account?.claimToken || !account.contactEmail) return;

      const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
      const claimUrl = `${webAppUrl}/gift/claim?token=${encodeURIComponent(account.claimToken)}`;
      await this.email.sendTransactional({
        to: account.contactEmail,
        subject: "Your Kudos card is on its way 🎉",
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
            <h1 style="font-size:20px">Thanks — your card is on its way!</h1>
            <p>We're printing your card and posting it out.</p>
            <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-top:16px">
              <p style="font-weight:600;margin:0 0 6px">Never miss their birthday again</p>
              <p style="margin:0 0 14px;color:#475569">
                Create a free account to save this contact, get a reminder next year, and let us send
                it for you automatically.
              </p>
              <a href="${claimUrl}"
                 style="background:#ef5b52;color:#fff;padding:10px 18px;border-radius:9999px;text-decoration:none;font-weight:600">
                Create your account
              </a>
            </div>
          </div>`,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Guest receipt email for order ${batchOrderId} failed: ${reason}`);
    }
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
