import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Account, MembershipRole } from "@prisma/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { MarketingContactsService } from "../marketing/marketing-contacts.service";
import { STRIPE_CLIENT } from "../billing/stripe-client.provider";
import { SUPABASE_ADMIN_CLIENT } from "../supabase/supabase-admin.provider";
import { OpsActivityService } from "../ops-activity/ops-activity.service";
import type { CreateAccountDto } from "./dto/create-account.dto";

/** An account safe to return over the API — without the claim-token secret. */
export type SafeAccount = Omit<Account, "claimToken" | "claimTokenExpiresAt">;

/** Prisma `select` of the SafeAccount columns — keeps the claim-token secret out
 * of any response object. Shared by every endpoint that returns an account. */
export const SAFE_ACCOUNT_SELECT = {
  id: true,
  type: true,
  name: true,
  stripeCustomerId: true,
  planId: true,
  contactEmail: true,
  reminderEmailsEnabled: true,
  extraSeats: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketing: MarketingContactsService,
    private readonly opsActivity: OpsActivityService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    @Inject(SUPABASE_ADMIN_CLIENT) private readonly supabaseAdmin: SupabaseClient,
  ) {}

  /** `email` (the signing-up user's, from their verified JWT) is stored as the
   * account's contactEmail so birthday reminders have somewhere to go. */
  async signup(userId: string, dto: CreateAccountDto, email: string | null): Promise<Account> {
    const existing = await this.prisma.membership.findFirst({ where: { userId } });
    if (existing) {
      throw new ConflictException("This user already belongs to an account");
    }

    const account = await this.prisma.$transaction(async (tx) => {
      const created = await tx.account.create({
        data: { type: dto.type, name: dto.name, planId: "free", contactEmail: email },
      });
      await tx.membership.create({
        data: { accountId: created.id, userId, role: "owner", email },
      });
      return created;
    });

    // Add the new subscriber to our Brevo marketing list for their account type
    // (individual vs organisation). Best-effort: the service swallows and logs
    // any error, so a Brevo hiccup can never fail a signup. Explicit first/last
    // name (individuals) is passed through for exact capture. See ADR 0152.
    await this.marketing.syncSubscriber(account, email, {
      firstName: dto.firstName,
      lastName: dto.lastName,
    });

    // Tell Kudos HQ. After the transaction and best-effort, so a notification
    // problem can never cost us a signup.
    await this.opsActivity.accountSignedUp(account.id);

    return account;
  }

  /** Toggle birthday-reminder emails for the account (opt-out). */
  async updateNotifications(
    accountId: string,
    reminderEmailsEnabled: boolean,
  ): Promise<SafeAccount> {
    return this.prisma.account.update({
      where: { id: accountId },
      data: { reminderEmailsEnabled },
      select: SAFE_ACCOUNT_SELECT,
    });
  }

  /**
   * Permanently delete an account and everything belonging to it — an owner-only,
   * irreversible action (the settings "Danger zone").
   *
   * Order matters:
   *  1. Owner-only + a typed-name confirmation, so this can't fire by accident.
   *  2. Block while cards are already paid-for and physically in production or in
   *     the post — deleting then would silently strand mail the customer paid for.
   *  3. Cancel any live Stripe subscription BEFORE touching data, and abort if
   *     that fails — we must never delete an account that keeps being billed.
   *  4. Delete the data. Occasions and order lines both hold a Restrict FK into
   *     SavedDesign, so they're cleared first; the account row then cascades the
   *     rest (recipients, designs, wallet, subscriptions, notifications, …).
   *  5. Remove the Supabase logins (best-effort — the data is already gone, and a
   *     login with no membership is locked out by MembershipGuard regardless).
   */
  async deleteAccount(
    accountId: string,
    actorRole: MembershipRole,
    confirmName: string,
  ): Promise<void> {
    if (actorRole !== "owner") {
      throw new ForbiddenException("Only the account owner can delete the account");
    }

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: {
        memberships: { select: { userId: true } },
        subscriptions: { select: { stripeSubscriptionId: true, status: true } },
      },
    });
    if (!account) {
      throw new NotFoundException("Account not found");
    }
    if (confirmName.trim() !== account.name.trim()) {
      throw new BadRequestException("Type your account name exactly to confirm deletion");
    }

    // Paid cards mid-fulfilment (in production or already posted) must not be
    // orphaned. Delivered/cancelled/returned lines are settled and fine to drop.
    const inFlight = await this.prisma.orderRecipient.count({
      where: {
        batchOrder: { accountId },
        status: { in: ["queued", "printed", "posted"] },
      },
    });
    if (inFlight > 0) {
      throw new ConflictException(
        `You have ${inFlight} card${inFlight === 1 ? "" : "s"} currently being printed or in the post. ` +
          "Please wait until they're delivered, or contact support, before deleting your account.",
      );
    }

    // Stop the billing relationship first — never delete an account we might keep
    // charging. A subscription already gone on Stripe's side is fine.
    for (const sub of account.subscriptions) {
      if (!["active", "trialing", "past_due"].includes(sub.status)) continue;
      try {
        await this.stripe.subscriptions.cancel(sub.stripeSubscriptionId);
      } catch (error) {
        if (error instanceof Stripe.errors.StripeError && error.code === "resource_missing") {
          continue;
        }
        this.logger.error(
          `Failed to cancel subscription ${sub.stripeSubscriptionId} for account ${accountId}: ${String(error)}`,
        );
        throw new ServiceUnavailableException(
          "Couldn't cancel your subscription just now. Please try again in a moment.",
        );
      }
    }

    // Clear the two Restrict FKs into SavedDesign, then let the account cascade
    // remove everything else. Deleting batch orders first cascades their order
    // lines (which reference occasions), so occasions delete cleanly next.
    await this.prisma.$transaction([
      this.prisma.batchOrder.deleteMany({ where: { accountId } }),
      this.prisma.occasion.deleteMany({ where: { accountId } }),
      this.prisma.account.delete({ where: { id: accountId } }),
    ]);

    for (const membership of account.memberships) {
      try {
        await this.supabaseAdmin.auth.admin.deleteUser(membership.userId);
      } catch (error) {
        this.logger.warn(
          `Account ${accountId} deleted, but removing Supabase user ${membership.userId} failed: ${String(error)}`,
        );
      }
    }

    this.logger.log(
      `Account ${accountId} deleted (${account.memberships.length} member(s), ${account.subscriptions.length} subscription record(s)).`,
    );
  }

  /** The claim token is a secret (whoever holds it can attach a login to the
   * account), so it never leaves the service — GET /accounts/me returns this.
   * An explicit `select` of the safe columns keeps the secret out of the row
   * entirely rather than fetching then stripping it. */
  async findById(accountId: string): Promise<SafeAccount> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: SAFE_ACCOUNT_SELECT,
    });
    if (!account) {
      throw new NotFoundException("Account not found");
    }
    return account;
  }
}
