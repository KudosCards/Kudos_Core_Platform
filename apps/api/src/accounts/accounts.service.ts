import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Account } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MarketingContactsService } from "../marketing/marketing-contacts.service";
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketing: MarketingContactsService,
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
    // any error, so a Brevo hiccup can never fail a signup. See ADR 0152.
    await this.marketing.syncSubscriber(account, email);

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
