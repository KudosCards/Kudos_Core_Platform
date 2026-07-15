import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Account } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateAccountDto } from "./dto/create-account.dto";

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

  async findById(accountId: string): Promise<Account> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException("Account not found");
    }
    return account;
  }
}
