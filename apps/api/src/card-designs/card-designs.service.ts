import { Injectable, NotFoundException } from "@nestjs/common";
import type { CardDesign } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { ListCardDesignsQueryDto } from "./dto/list-card-designs-query.dto";

/**
 * Read-only template catalog — see docs/adr/0006-phase-2-scope.md. Not
 * account-scoped: templates are shared, global content. Mutation (adding new
 * templates) is seed/admin-managed for now, not exposed over the API.
 */
@Injectable()
export class CardDesignsService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: ListCardDesignsQueryDto): Promise<CardDesign[]> {
    return this.prisma.cardDesign.findMany({
      where: {
        isActive: true,
        ...(query.category && { category: query.category }),
      },
      orderBy: { name: "asc" },
    });
  }

  async findOne(id: string): Promise<CardDesign> {
    const design = await this.prisma.cardDesign.findFirst({ where: { id, isActive: true } });
    if (!design) {
      throw new NotFoundException("Card design not found");
    }
    return design;
  }
}
