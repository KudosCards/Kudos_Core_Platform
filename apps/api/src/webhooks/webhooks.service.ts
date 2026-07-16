import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { STRIPE_CLIENT } from "../billing/stripe-client.provider";
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
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
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
    const batchOrderId = session.metadata?.batchOrderId;
    if (!batchOrderId) {
      // Subscription-mode sessions carry no batchOrderId — that plan change
      // is handled entirely by the customer.subscription.* events below.
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      // Status-guarded: Stripe redelivers webhooks at-least-once, so a
      // second delivery of the same event must be a safe no-op, not a
      // second FulfillmentJob per card.
      const { count } = await tx.batchOrder.updateMany({
        where: { id: batchOrderId, status: "pending_payment" },
        data: { status: "paid" },
      });
      if (count === 0) {
        return;
      }

      const orderRecipients = await tx.orderRecipient.findMany({
        where: { batchOrderId, status: "approved" },
      });
      await tx.orderRecipient.updateMany({
        where: { batchOrderId, status: "approved" },
        data: { status: "queued" },
      });
      await tx.fulfillmentJob.createMany({
        data: orderRecipients.map((recipient) => ({
          orderRecipientId: recipient.id,
          status: "pending",
        })),
        skipDuplicates: true,
      });

      const order = await tx.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } });
      await this.audit.record({
        accountId: order.accountId,
        actorUserId: SYSTEM_ACTOR,
        action: "payment_succeeded",
        targetType: "BatchOrder",
        targetId: batchOrderId,
        metadata: { stripeCheckoutSessionId: session.id },
      });
    });
  }

  private async handlePaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const order = await this.prisma.batchOrder.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });
    if (!order) {
      return;
    }

    // BatchOrder stays "pending_payment" — Stripe's own retry/dunning flow
    // applies, and the customer can always restart checkout on the same
    // draft-turned-pending order via a fresh Checkout Session.
    await this.audit.record({
      accountId: order.accountId,
      actorUserId: SYSTEM_ACTOR,
      action: "payment_failed",
      targetType: "BatchOrder",
      targetId: order.id,
      metadata: { stripePaymentIntentId: paymentIntent.id },
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
