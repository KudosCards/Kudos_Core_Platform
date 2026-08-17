import { Injectable, NotFoundException } from "@nestjs/common";
import type { CardDesign } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { ListCardDesignsQueryDto } from "./dto/list-card-designs-query.dto";

/** RFC 4122 UUID, any version — matches what @IsUUID()/ParseUUIDPipe accept. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  /**
   * Resolve a design by its UUID **or** its public slug.
   *
   * The catalog moved to `/cards/<category>/<slug>` (ADR 0163), so the web app
   * looks designs up by slug — but the UUID form is in Google's index, in
   * customers' saved links, and on QR codes already printed, so both must keep
   * working. A UUID-shaped identifier can't collide with a slug, since slugs
   * only ever contain `[a-z0-9-]` in name-derived form and are matched exactly.
   */
  async findOne(idOrSlug: string): Promise<CardDesign> {
    const design = await this.prisma.cardDesign.findFirst({
      where: {
        isActive: true,
        ...(UUID_PATTERN.test(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }),
      },
    });
    if (!design) {
      throw new NotFoundException("Card design not found");
    }
    return design;
  }
}
