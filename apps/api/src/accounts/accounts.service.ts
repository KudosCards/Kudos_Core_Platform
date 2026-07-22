import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Account } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateAccountDto } from "./dto/create-account.dto";

/** An account safe to return over the API — without the claim-token secret. */
export type SafeAccount = Omit<Account, "claimToken" | "claimTokenExpiresAt">;

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async signup(userId: string, dto: CreateAccountDto): Promise<Account> {
    const existing = await this.prisma.membership.findFirst({ where: { userId } });
    if (existing) {
      throw new ConflictException("This user already belongs to an account");
    }

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: { type: dto.type, name: dto.name, planId: "free" },
      });
      await tx.membership.create({
        data: { accountId: account.id, userId, role: "owner" },
      });
      return account;
    });
  }

  /** The claim token is a secret (whoever holds it can attach a login to the
   * account), so it never leaves the service — GET /accounts/me returns this.
   * An explicit `select` of the safe columns keeps the secret out of the row
   * entirely rather than fetching then stripping it. */
  async findById(accountId: string): Promise<SafeAccount> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        type: true,
        name: true,
        stripeCustomerId: true,
        planId: true,
        contactEmail: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!account) {
      throw new NotFoundException("Account not found");
    }
    return account;
  }
}
