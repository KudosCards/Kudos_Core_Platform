import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { MembershipRole } from "@prisma/client";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { CENTRE_SEAT_PRICE_MINOR } from "../billing/billing.constants";
import type { EnvConfig } from "../config/env.schema";
import type { CheckoutResult } from "../common/checkout-result";
import { STRIPE_CLIENT } from "../billing/stripe-client.provider";
import { SeatBillingService } from "../billing/seat-billing.service";
import type { CreateSubscriptionCheckoutDto } from "./dto/create-subscription-checkout.dto";

/** The account's seat position after a change — enough for the UI to render the
 * "using X of Y seats" meter without a second round-trip. */
export interface SeatSummary {
  includedSeats: number;
  extraSeats: number;
  /** includedSeats + extraSeats — the hard cap the invite guard enforces. */
  limit: number;
  /** Active members + pending invites. */
  used: number;
  /** Per-extra-seat price in pence, for display. */
  seatPriceMinor: number;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly seatBilling: SeatBillingService,
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
    const priceId = this.resolvePlanPriceId(dto.planId, entitlement.stripePriceId);
    if (!priceId) {
      throw new ConflictException(`Plan "${dto.planId}" is not yet configured for checkout`);
    }

    // Without this guard, an account could end up with two live Stripe
    // subscriptions (e.g. a second checkout completed before the first
    // subscription.created webhook lands, or a customer wanting to switch
    // plans without first cancelling) — double-billing, and Account.planId
    // left to flap between whichever subscription's webhook arrives last.
    // Changing plans in-place isn't built yet, so the safe behaviour for now
    // is to block a second subscription rather than silently create one.
    const existingSubscription = await this.prisma.subscription.findFirst({
      where: { accountId, status: { in: ["active", "trialing", "past_due"] } },
    });
    if (existingSubscription) {
      throw new ConflictException(
        "This account already has an active subscription — contact us to change plans",
      );
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
      line_items: [{ price: priceId, quantity: 1 }],
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

  /** Resolve a paid plan's Stripe Price id: the `STRIPE_PRICE_ID_<PLAN>` env var
   * wins (so setting it in Railway + redeploy activates the plan with no
   * re-seed), falling back to the seeded PlanEntitlement.stripePriceId. Returns
   * null when neither is set — checkout then reports "not configured". See
   * docs/adr/0036-payment-go-live.md. */
  private resolvePlanPriceId(planId: "pro" | "centre", seededPriceId: string | null): string | null {
    const envKey = planId === "pro" ? "STRIPE_PRICE_ID_PRO" : "STRIPE_PRICE_ID_CENTRE";
    return this.config.get(envKey, { infer: true }) ?? seededPriceId ?? null;
  }

  /** Read the account's current seat position (no mutation). Shared by the team
   * view and returned after a seat change. */
  async getSeatSummary(accountId: string): Promise<SeatSummary> {
    const entitlement = await this.entitlements.getForAccount(accountId);
    const [account, memberCount, inviteCount] = await Promise.all([
      this.prisma.account.findUniqueOrThrow({
        where: { id: accountId },
        select: { extraSeats: true },
      }),
      this.prisma.membership.count({ where: { accountId } }),
      this.prisma.invite.count({ where: { accountId, status: "pending" } }),
    ]);
    return {
      includedSeats: entitlement.includedSeats,
      extraSeats: account.extraSeats,
      limit: entitlement.includedSeats + account.extraSeats,
      used: memberCount + inviteCount,
      seatPriceMinor: CENTRE_SEAT_PRICE_MINOR,
    };
  }

  /**
   * Set the account's paid **extra** seat count (an absolute target, so the call
   * is idempotent). Updates the Stripe subscription's per-seat line-item quantity
   * (Stripe prorates) and mirrors the new count onto the account, which is the
   * source of truth the invite hard-block reads. Owner/admin only. Can't reduce
   * below what's already in use — remove members/invites first. See ADR 0035.
   */
  async setExtraSeats(
    accountId: string,
    actorUserId: string,
    role: MembershipRole,
    targetExtraSeats: number,
  ): Promise<SeatSummary> {
    if (role !== "owner" && role !== "admin") {
      throw new ForbiddenException("Only an owner or admin can change team seats");
    }
    if (!Number.isInteger(targetExtraSeats) || targetExtraSeats < 0) {
      throw new BadRequestException("extraSeats must be a non-negative whole number");
    }

    const entitlement = await this.entitlements.getForAccount(accountId);
    if (!entitlement.teamSeatsEnabled) {
      throw new ForbiddenException("Team seats are available on the Centre plan");
    }

    const seatPriceId = await this.seatBilling.resolveSeatPriceId();
    if (!seatPriceId) {
      throw new ConflictException("Seat billing is not configured yet");
    }

    // Can't cut seats below what's in use — the hard-block would otherwise be
    // retroactively violated by members/invites already occupying seats.
    const [memberCount, inviteCount] = await Promise.all([
      this.prisma.membership.count({ where: { accountId } }),
      this.prisma.invite.count({ where: { accountId, status: "pending" } }),
    ]);
    const used = memberCount + inviteCount;
    const newLimit = entitlement.includedSeats + targetExtraSeats;
    if (newLimit < used) {
      throw new ConflictException(
        `You're using ${used} of your seats — remove members or invites before reducing to ${newLimit}`,
      );
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { accountId, status: { in: ["active", "trialing", "past_due"] } },
    });
    if (!subscription) {
      throw new ConflictException("This account has no active subscription to add seats to");
    }

    // Reflect the target quantity onto the subscription's seat line item: update
    // an existing one, add one if there isn't yet, or delete it at zero.
    const stripeSub = await this.stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const seatItem = stripeSub.items.data.find((item) => item.price.id === seatPriceId);
    const itemUpdate = this.buildSeatItemUpdate(seatItem?.id, seatPriceId, targetExtraSeats);
    if (itemUpdate) {
      await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        items: [itemUpdate],
        proration_behavior: "create_prorations",
      });
    }

    await this.prisma.account.update({
      where: { id: accountId },
      data: { extraSeats: targetExtraSeats },
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "set_team_seats",
      targetType: "Account",
      targetId: accountId,
      metadata: { extraSeats: targetExtraSeats, limit: newLimit },
    });

    return {
      includedSeats: entitlement.includedSeats,
      extraSeats: targetExtraSeats,
      limit: newLimit,
      used,
      seatPriceMinor: CENTRE_SEAT_PRICE_MINOR,
    };
  }

  /** The single subscription-item change that makes the seat line reflect
   * `quantity`: update an existing item, add one, delete it at zero, or nothing
   * to do when there's no item and no seats. */
  private buildSeatItemUpdate(
    existingItemId: string | undefined,
    seatPriceId: string,
    quantity: number,
  ): Stripe.SubscriptionUpdateParams.Item | null {
    if (existingItemId) {
      return quantity > 0
        ? { id: existingItemId, quantity }
        : { id: existingItemId, deleted: true };
    }
    return quantity > 0 ? { price: seatPriceId, quantity } : null;
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
