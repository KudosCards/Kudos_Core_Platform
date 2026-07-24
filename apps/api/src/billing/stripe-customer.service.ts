import { Inject, Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { STRIPE_CLIENT } from "./stripe-client.provider";

/**
 * The one place that maps an account to its Stripe Customer. Every billing
 * surface that needs a customer — subscription checkout, the billing portal —
 * goes through here so the "create once, then reuse" invariant (and its
 * race-safety) lives in a single spot rather than being copied per call site.
 */
@Injectable()
export class StripeCustomerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  /**
   * Reuses the account's existing Stripe Customer if it has one, otherwise
   * creates one and persists it. The persist is status-guarded (an
   * `updateMany` on `stripeCustomerId: null`), so if two requests raced to
   * create a Customer for the same account only the winner's id is kept and
   * both callers return that same id — an account never ends up with two
   * Customers.
   */
  async getOrCreate(accountId: string): Promise<string> {
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    if (account.stripeCustomerId) {
      return account.stripeCustomerId;
    }

    const customer = await this.stripe.customers.create({
      name: account.name,
      metadata: { accountId },
    });

    const { count } = await this.prisma.account.updateMany({
      where: { id: accountId, stripeCustomerId: null },
      data: { stripeCustomerId: customer.id },
    });
    if (count === 0) {
      const fresh = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
      return fresh.stripeCustomerId ?? customer.id;
    }
    return customer.id;
  }
}
