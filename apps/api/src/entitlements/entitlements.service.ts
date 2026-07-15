import { Injectable, NotFoundException } from "@nestjs/common";
import type { PlanEntitlement } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async getForAccount(accountId: string): Promise<PlanEntitlement> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { planId: true },
    });
    if (!account?.planId) {
      throw new NotFoundException("Account has no plan assigned");
    }

    const entitlement = await this.prisma.planEntitlement.findUnique({
      where: { planId: account.planId },
    });
    if (!entitlement) {
      throw new NotFoundException(`No entitlement configuration for plan "${account.planId}"`);
    }
    return entitlement;
  }
}
