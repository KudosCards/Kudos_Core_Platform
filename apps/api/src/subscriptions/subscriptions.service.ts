import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { EnvConfig } from "../config/env.schema";
import type { CheckoutResult } from "../common/checkout-result";
import { STRIPE_CLIENT } from "../billing/stripe-client.provider";
import type { CreateSubscriptionCheckoutDto } from "./dto/create-subscription-checkout.dto";

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  async createCheckout(
    accountId: string,
    actorUserId: string,
    dto: CreateSubscriptionCheckoutDto,
  ): Promise<CheckoutResult> {
    const entitlement = await this.prisma.planEntitlement.findUnique({
      where: { planId: dto.planId },
    });
    if (!entitlement) {
      throw new NotFoundException(`Unknown plan "${dto.planId}"`);
    }
    if (!entitlement.stripePriceId) {
      throw new ConflictException(`Plan "${dto.planId}" is not yet configured for checkout`);
    }

    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const stripeCustomerId = await this.getOrCreateStripeCustomer(
      account.id,
      account.name,
      account.stripeCustomerId,
    );

    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: entitlement.stripePriceId, quantity: 1 }],
      subscription_data: { metadata: { accountId, planId: dto.planId } },
      success_url: `${webAppUrl}/billing/success`,
      cancel_url: `${webAppUrl}/billing/cancelled`,
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "subscription_checkout",
      targetType: "Account",
      targetId: accountId,
      metadata: { planId: dto.planId, stripeCheckoutSessionId: session.id },
    });

    if (!session.url) {
      throw new ConflictException("Stripe did not return a checkout URL");
    }
    return { checkoutUrl: session.url };
  }

  /** Reuses the account's existing Stripe Customer if it has one, otherwise
   * creates one and persists it — every future checkout for this account
   * then reuses the same Customer, matching how Stripe expects a single
   * paying entity to be represented. */
  private async getOrCreateStripeCustomer(
    accountId: string,
    accountName: string,
    existingCustomerId: string | null,
  ): Promise<string> {
    if (existingCustomerId) {
      return existingCustomerId;
    }

    const customer = await this.stripe.customers.create({
      name: accountName,
      metadata: { accountId },
    });

    // Status-guarded, not a bare update: if two checkout requests raced to
    // create a Customer for this account, only the winner's id is kept.
    const { count } = await this.prisma.account.updateMany({
      where: { id: accountId, stripeCustomerId: null },
      data: { stripeCustomerId: customer.id },
    });
    if (count === 0) {
      const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
      return account.stripeCustomerId ?? customer.id;
    }
    return customer.id;
  }
}
